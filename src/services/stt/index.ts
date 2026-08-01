import {Platform} from 'react-native';

import {audioCapture, requestMicPermission} from './audio/AudioCapture';
import {AudioPreRoll} from './audio/AudioPreRoll';
import {SileroVAD} from './vad/SileroVAD';
import {MoonshineEngine} from './engines/MoonshineEngine';
import {WhisperEngine} from './engines/WhisperEngine';
import type {ASREngine, STTASREngineId, STTSessionCallbacks} from './types';

/** @siteed/moonshine.rn declares minSdkVersion 35 (Android 15). */
export const MOONSHINE_MIN_ANDROID_API = 35;

export function isASREngineSupported(engine: STTASREngineId): boolean {
  if (engine === 'moonshine' && Platform.OS === 'android') {
    return Number(Platform.Version) >= MOONSHINE_MIN_ANDROID_API;
  }
  return true;
}

export function selectASREngine(id: STTASREngineId): ASREngine {
  switch (id) {
    case 'moonshine':
      return new MoonshineEngine();
    case 'whisper':
      return new WhisperEngine();
  }
}

interface SessionHandle {
  ready?: Promise<void>;
  /** `finalize` is true for an explicit user stop and false for teardown. */
  stop: (finalize?: boolean) => Promise<void>;
}

let active: SessionHandle | null = null;
let activeEngine: ASREngine | null = null;
let cachedEngine: ASREngine | null = null;
let engineIdleTimer: ReturnType<typeof setTimeout> | null = null;
const ENGINE_IDLE_RELEASE_MS = 30_000;

function cancelEngineIdleRelease() {
  if (engineIdleTimer) {
    clearTimeout(engineIdleTimer);
    engineIdleTimer = null;
  }
}

function scheduleEngineIdleRelease(engine: ASREngine) {
  cancelEngineIdleRelease();
  engineIdleTimer = setTimeout(() => {
    if (!active && cachedEngine === engine) {
      cachedEngine = null;
      engine
        .release()
        .catch(error =>
          console.warn('[sttRuntime] idle engine release failed:', error),
        );
    }
    engineIdleTimer = null;
  }, ENGINE_IDLE_RELEASE_MS);
}

const SAMPLE_RATE = 16000;
// moonshine.rn's legacy bridge materializes JS arrays. Feeding 32 ms recorder
// callbacks individually causes one native transcription pass per callback;
// 200 ms is within the package's recommended 100-250 ms range.
const ASR_BATCH_SAMPLES = 3200;
const ASR_BACKLOG_WARNING_SAMPLES = SAMPLE_RATE * 2;

/** Ordered, lossless batching around addAudioToStream. */
function createStreamingFeed(
  engine: ASREngine,
  streamId: string,
  onError: (error: unknown) => void,
) {
  let staging: number[] = [];
  let chain = Promise.resolve();
  let queuedSamples = 0;
  let firstError: unknown = null;
  let errorReported = false;

  const schedule = (samples: number[]) => {
    queuedSamples += samples.length;
    if (queuedSamples >= ASR_BACKLOG_WARNING_SAMPLES) {
      console.warn(
        `[sttRuntime] ASR feed is ${Math.round((queuedSamples / SAMPLE_RATE) * 1000)} ms behind`,
      );
    }
    chain = chain.then(async () => {
      if (firstError) {
        queuedSamples -= samples.length;
        return;
      }
      try {
        await engine.feedStream(streamId, samples, SAMPLE_RATE);
      } catch (error) {
        firstError = error;
        if (!errorReported) {
          errorReported = true;
          onError(error);
        }
      } finally {
        queuedSamples -= samples.length;
      }
    });
  };

  const drainBatches = () => {
    while (staging.length >= ASR_BATCH_SAMPLES) {
      schedule(staging.splice(0, ASR_BATCH_SAMPLES));
    }
  };

  return {
    pushFloat(samples: Float32Array) {
      for (let i = 0; i < samples.length; i++) {
        staging.push(samples[i]);
      }
      drainBatches();
    },
    pushNumbers(samples: number[]) {
      staging.push(...samples);
      drainBatches();
    },
    async flush(): Promise<void> {
      if (staging.length) {
        schedule(staging);
        staging = [];
      }
      await chain;
      if (firstError) {
        throw firstError;
      }
    },
    discard() {
      staging = [];
    },
  };
}

// --- Manual tap-to-stop streaming fallback --------------------------------

async function startBasicSession(
  engine: ASREngine,
  _settings: {endpointSilenceMs: number},
  callbacks: STTSessionCallbacks,
): Promise<SessionHandle> {
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const streamId = await engine.startStream(event => {
    if (!stopped && event.type === 'partial') {
      callbacks.onPartialText(event.text);
    }
  });
  const feed = createStreamingFeed(engine, streamId, callbacks.onError);

  audioCapture.setSubscriber(float => {
    if (!stopped) {
      feed.pushFloat(float);
    }
  });
  await audioCapture.start();

  return {
    stop: async (shouldFinalize = false) => {
      if (stopPromise) {
        return stopPromise;
      }
      stopPromise = (async () => {
        await audioCapture.stop();
        stopped = true;
        if (!shouldFinalize) {
          feed.discard();
          await engine.cancelStream(streamId);
          return;
        }
        callbacks.onEndpoint();
        try {
          await feed.flush();
          const text = await engine.endStream(streamId);
          if (text.trim()) {
            callbacks.onFinalText(text);
          }
        } catch (error) {
          callbacks.onError(error);
        }
      })();
      return stopPromise;
    },
  };
}

// --- Silero endpointing + incremental Moonshine stream ---------------------

const VAD_SPEECH_THRESHOLD = 0.35;
const ENERGY_FLOOR = 0.006;
const ENERGY_NOISE_MULTIPLIER = 3;
const VAD_START_FRAMES = 2;
const PRE_ROLL_SAMPLES = 10240; // 640 ms @ 16 kHz

async function startSileroSession(
  engine: ASREngine,
  settings: {endpointSilenceMs: number},
  callbacks: STTSessionCallbacks,
): Promise<SessionHandle> {
  const vad = new SileroVAD();

  let stopped = false;
  let acceptingAudio = true;
  let ready = false;
  let speaking = false;
  let completed = false;
  let speechStartFrames = 0;
  let trailingSilenceSamples = 0;
  let noiseFloor = 0.001;
  const preRoll = new AudioPreRoll(PRE_ROLL_SAMPLES);
  const pending: Float32Array[] = [];
  let pumping = false;
  let streamId: string | null = null;
  let feed: ReturnType<typeof createStreamingFeed> | null = null;
  let finalizePromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const finalize = async (stopCapture: boolean) => {
    if (finalizePromise) {
      return finalizePromise;
    }
    finalizePromise = (async () => {
      speaking = false;
      completed = true;
      callbacks.onEndpoint();

      // Automatic endpointing seals the utterance immediately. Recognition
      // may flush slowly, but capture/VAD must not continue accumulating audio
      // that can no longer belong to this single-utterance session.
      if (stopCapture) {
        acceptingAudio = false;
        pending.length = 0;
        // Do not gate final recognition on the native recorder's stop promise.
        // On some Android devices it can remain pending when endpointing is
        // initiated near an audio event, leaving the UI in `processing` and
        // preventing auto-submit. acceptingAudio already rejects late chunks.
        audioCapture.stop().catch(error => {
          console.warn('[sttRuntime] endpoint capture stop failed:', error);
        });
      }

      try {
        await feed?.flush();
        const text = streamId ? await engine.endStream(streamId) : '';
        streamId = null;
        stopped = true;
        // Completion must be reported even when recognition produced no text;
        // otherwise the store remains in `processing` indefinitely.
        callbacks.onFinalText(text);
      } catch (error) {
        stopped = true;
        callbacks.onError(error);
      }
    })();
    return finalizePromise;
  };

  const handleChunk = async (float: Float32Array) => {
    const probs = await vad.process(float);
    const probability = probs.length ? Math.max(...probs) : 0;
    let sumSquares = 0;
    for (let i = 0; i < float.length; i++) {
      sumSquares += float[i] * float[i];
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, float.length));
    const sileroSpeech = probability >= VAD_SPEECH_THRESHOLD;
    if (!speaking && !sileroSpeech) {
      noiseFloor = noiseFloor * 0.97 + rms * 0.03;
    }
    const energyThreshold = Math.max(
      ENERGY_FLOOR,
      noiseFloor * ENERGY_NOISE_MULTIPLIER,
    );
    const hasSpeech = sileroSpeech || rms >= energyThreshold;

    if (!speaking) {
      if (hasSpeech) {
        speechStartFrames += 1;
      } else {
        speechStartFrames = 0;
      }
      if (speechStartFrames < VAD_START_FRAMES) {
        preRoll.append(float);
        return;
      }

      speaking = true;
      trailingSilenceSamples = 0;
      callbacks.onSpeechStart?.();
      const leadIn: number[] = [];
      preRoll.drainInto(leadIn);
      feed?.pushNumbers(leadIn);
    }

    feed?.pushFloat(float);
    trailingSilenceSamples = hasSpeech
      ? 0
      : trailingSilenceSamples + float.length;
    const endpointSilenceSamples = Math.round(
      (settings.endpointSilenceMs / 1000) * SAMPLE_RATE,
    );
    if (trailingSilenceSamples >= endpointSilenceSamples) {
      await finalize(true);
    }
  };

  const pump = async () => {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (!stopped && !completed && pending.length) {
        await handleChunk(pending.shift()!);
      }
    } catch (error) {
      console.warn('[sttRuntime] pump error:', error);
      acceptingAudio = false;
      stopped = true;
      pending.length = 0;
      await audioCapture.stop();
      await vad.release();
      callbacks.onError(error);
    } finally {
      pumping = false;
    }
  };

  audioCapture.setSubscriber(float => {
    if (!acceptingAudio || stopped || completed) {
      return;
    }
    pending.push(float);
    if (ready) {
      pump().catch(error => console.warn('[sttRuntime] pump start:', error));
    }
  });

  // Capture first so speech during a cold model load is retained in `pending`.
  await audioCapture.start();
  const readyPromise = (async () => {
    try {
      await Promise.all([engine.init(), vad.load()]);
      streamId = await engine.startStream(event => {
        if (!stopped && !completed && event.type === 'partial') {
          callbacks.onPartialText(event.text);
        }
      });
      feed = createStreamingFeed(engine, streamId, callbacks.onError);
      ready = true;
      await pump();
    } catch (error) {
      acceptingAudio = false;
      stopped = true;
      pending.length = 0;
      await audioCapture.stop();
      await vad.release();
      throw error;
    }
  })();

  const waitForPumpToDrain = async () => {
    while (pumping || pending.length > 0) {
      if (!pumping && pending.length > 0) {
        await pump();
      } else {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
  };

  return {
    ready: readyPromise,
    stop: async (shouldFinalize = false) => {
      if (stopPromise) {
        return stopPromise;
      }
      stopPromise = (async () => {
        if (completed) {
          await finalizePromise;
          await vad.release();
          return;
        }

        await audioCapture.stop();
        acceptingAudio = false;
        if (shouldFinalize) {
          await waitForPumpToDrain();
          if (speaking) {
            await finalize(false);
          } else if (streamId) {
            feed?.discard();
            await engine.cancelStream(streamId).catch(() => {});
            streamId = null;
          }
        } else {
          stopped = true;
          pending.length = 0;
          feed?.discard();
          if (streamId) {
            await engine.cancelStream(streamId).catch(() => {});
            streamId = null;
          }
          while (pumping) {
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
        stopped = true;
        await vad.release();
      })();
      return stopPromise;
    },
  };
}

export const sttRuntime = {
  getActiveEngineId(): STTASREngineId | null {
    return activeEngine?.id ?? null;
  },

  async startSession(
    settings: {
      endpoint: string;
      endpointSilenceMs: number;
      asrEngine: STTASREngineId;
    },
    callbacks: STTSessionCallbacks,
  ): Promise<void> {
    if (active) {
      await this.stopSession();
    }
    const granted = await requestMicPermission();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }
    audioCapture.init();

    cancelEngineIdleRelease();
    if (cachedEngine && cachedEngine.id !== settings.asrEngine) {
      await cachedEngine.release().catch(() => {});
      cachedEngine = null;
    }
    const engine = cachedEngine ?? selectASREngine(settings.asrEngine);
    cachedEngine = engine;
    try {
      activeEngine = engine;
      if (settings.endpoint === 'basic') {
        await engine.init();
        active = await startBasicSession(engine, settings, callbacks);
      } else if (settings.endpoint === 'silero') {
        active = await startSileroSession(engine, settings, callbacks);
        await active.ready;
      } else {
        throw new Error(
          `[sttRuntime] unsupported endpoint '${settings.endpoint}'`,
        );
      }
    } catch (error) {
      active = null;
      activeEngine = null;
      if (cachedEngine === engine) {
        cachedEngine = null;
      }
      await engine.release().catch(() => {});
      throw error;
    }
  },

  async stopSession(finalize = false): Promise<void> {
    const session = active;
    const engine = activeEngine;
    active = null;
    activeEngine = null;
    try {
      await session?.stop(finalize);
    } catch (error) {
      console.warn('[sttRuntime] session stop failed:', error);
    }
    if (engine) {
      // Avoid a full native model reload on a quick second dictation. The
      // cache is short-lived and explicit release/background teardown still
      // frees it immediately.
      scheduleEngineIdleRelease(engine);
    }
  },

  async release(): Promise<void> {
    cancelEngineIdleRelease();
    if (active) {
      await this.stopSession();
      cancelEngineIdleRelease();
    }
    const engine = cachedEngine ?? activeEngine;
    cachedEngine = null;
    activeEngine = null;
    if (engine) {
      try {
        await engine.release();
      } catch (error) {
        console.warn('[sttRuntime] release failed:', error);
      }
    }
  },
};

export * from './types';
