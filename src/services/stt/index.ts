import {Platform} from 'react-native';

import {audioCapture, requestMicPermission} from './audio/AudioCapture';
import {AudioPreRoll} from './audio/AudioPreRoll';
import {SileroVAD} from './vad/SileroVAD';
import {MoonshineEngine} from './engines/MoonshineEngine';
import {WhisperEngine} from './engines/WhisperEngine';
import type {ASREngine, STTASREngineId, STTSessionCallbacks} from './types';

/**
 * STT runtime facade — the ASR-engine counterpart to services/tts's
 * `ttsRuntime`. Owns the live mic stream, the endpointer, and the active ASR
 * engine, and drives the store's callbacks (onPartialText / onFinalText /
 * onEndpoint / onError).
 *
 * Two endpoint strategies (STTStore.endpoint):
 *  - 'basic'  : Moonshine's own streaming + internal VAD. Lowest code, engine
 *               owns segmentation; we relay lineUpdated/lineCompleted events.
 *               (endpointSilenceMs is advisory here — Moonshine's VAD governs.)
 *  - 'silero'  : we own the mic, run Silero VAD frame-by-frame, accumulate a
 *               gated utterance, fire periodic partial transcriptions for the
 *               streaming-input UX, and finalize + endpoint when trailing
 *               silence >= endpointSilenceMs. This is the default; it also
 *               gives clean audio to ASR (no silence hallucination) and is the
 *               uniform pipeline the wake-word trigger (v2a) will plug into.
 *
 * The 'silero' path uses a single async pump so onnxruntime's async
 * session.run is never reentered; capture frames enqueue and drain in order.
 */

/** @siteed/moonshine.rn declares minSdkVersion 35 (Android 15). */
export const MOONSHINE_MIN_ANDROID_API = 35;

export function isASREngineSupported(engine: STTASREngineId): boolean {
  if (engine === 'moonshine') {
    if (Platform.OS === 'android') {
      return Number(Platform.Version) >= MOONSHINE_MIN_ANDROID_API;
    }
    return true;
  }
  return true; // 'whisper'
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
  /** `finalize` is true for an explicit user stop and false for teardown. */
  stop: (finalize?: boolean) => Promise<void>;
}

let active: SessionHandle | null = null;
let activeEngine: ASREngine | null = null;

// --- 'basic': Moonshine native streaming + VAD -----------------------------

async function startBasicSession(
  engine: ASREngine,
  _settings: {endpointSilenceMs: number},
  callbacks: STTSessionCallbacks,
): Promise<SessionHandle> {
  let stopped = false;
  const streamId = await engine.startStream(event => {
    if (stopped) {
      return;
    }
    if (event.type === 'partial') {
      callbacks.onPartialText(event.text);
    } else if (event.type === 'final') {
      callbacks.onEndpoint();
      callbacks.onFinalText(event.text);
    }
  });

  audioCapture.setSubscriber(float => {
    if (stopped) {
      return;
    }
    // Fire-and-forget; the native side queues addAudioToStream calls.
    engine
      .feedStream(streamId, Array.from(float), 16000)
      .catch(err => console.warn('[sttRuntime] feedStream failed:', err));
  });
  await audioCapture.start();

  return {
    stop: async () => {
      stopped = true;
      await audioCapture.stop();
      await engine.endStream(streamId).catch(() => {});
      await engine.cancelStream(streamId).catch(() => {});
    },
  };
}

// --- 'silero': owned mic + Silero VAD -> offline transcribe -----------------

const VAD_SPEECH_THRESHOLD = 0.35;
// Some Android audio-processing stacks suppress speech enough to make Silero
// under-confident. RMS is a conservative fallback so real mic input is not
// silently discarded solely because VAD stayed below its threshold.
const RMS_SPEECH_THRESHOLD = 0.01;
const PARTIAL_INTERVAL_MS = 750;
const MIN_PARTIAL_SAMPLES = 8000; // 500 ms @ 16 kHz
// Silero intentionally waits for confidence before declaring speech. Preserve
// audio immediately before that decision so low-energy initial phonemes are
// still included in the Moonshine utterance.
const PRE_ROLL_SAMPLES = 5120; // 320 ms @ 16 kHz (10 Silero windows)

async function startSileroSession(
  engine: ASREngine,
  settings: {endpointSilenceMs: number},
  callbacks: STTSessionCallbacks,
): Promise<SessionHandle> {
  const vad = new SileroVAD();
  await vad.load();

  let stopped = false;
  let speaking = false;
  let lastSpeechAt = 0;
  let lastPartialAt = 0;
  let partialInFlight = false;
  const utterance: number[] = [];
  const preRoll = new AudioPreRoll(PRE_ROLL_SAMPLES);
  const pending: Float32Array[] = [];
  let pumping = false;

  const emitPartial = async () => {
    if (partialInFlight || utterance.length === 0) {
      return;
    }
    partialInFlight = true;
    try {
      const text = await engine.transcribe(utterance.slice(), 16000);
      if (!stopped && speaking) {
        callbacks.onPartialText(text);
      }
    } catch (err) {
      console.warn('[sttRuntime] partial transcribe failed:', err);
    } finally {
      partialInFlight = false;
    }
  };

  const finalize = async (emitWhenStopped = false) => {
    speaking = false;
    // Drain any in-flight partial so we never issue two concurrent
    // transcribe() calls against the same native transcriber.
    while (partialInFlight) {
      await new Promise(r => setTimeout(r, 10));
    }
    if (utterance.length === 0) {
      return;
    }
    try {
      const text = await engine.transcribe(utterance.slice(), 16000);
      if ((!stopped || emitWhenStopped) && text.trim()) {
        callbacks.onEndpoint();
        callbacks.onFinalText(text);
      }
    } catch (err) {
      callbacks.onError(err);
    }
    utterance.length = 0;
    vad.reset();
  };

  const handleChunk = async (float: Float32Array) => {
    const probs = await vad.process(float);
    const prob = probs.length ? Math.max(...probs) : 0;
    let sumSquares = 0;
    for (let i = 0; i < float.length; i++) {
      sumSquares += float[i] * float[i];
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, float.length));
    const hasSpeech = prob > VAD_SPEECH_THRESHOLD || rms > RMS_SPEECH_THRESHOLD;
    const now = Date.now();
    if (hasSpeech) {
      lastSpeechAt = now;
    }
    if (!speaking) {
      if (!hasSpeech) {
        preRoll.append(float);
        return;
      }

      speaking = true;
      utterance.length = 0;
      // Include the rolling audio captured before VAD triggered. This avoids
      // clipping quiet word onsets such as /h/, /f/, and /s/.
      preRoll.drainInto(utterance);
      lastPartialAt = now;
      callbacks.onPartialText('');
    }
    if (speaking) {
      for (let i = 0; i < float.length; i++) {
        utterance.push(float[i]);
      }
      if (
        utterance.length >= MIN_PARTIAL_SAMPLES &&
        now - lastPartialAt >= PARTIAL_INTERVAL_MS
      ) {
        lastPartialAt = now;
        // Fire-and-forget; guarded by partialInFlight to prevent overlap.
        emitPartial().catch(err =>
          console.warn('[sttRuntime] emitPartial:', err),
        );
      }
      if (lastSpeechAt && now - lastSpeechAt >= settings.endpointSilenceMs) {
        await finalize();
      }
    }
  };

  const pump = async () => {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (!stopped && pending.length) {
        const chunk = pending.shift()!;
        await handleChunk(chunk);
      }
    } catch (err) {
      // Previously this was only logged, leaving the store in its listening
      // state and making a failed mic tap appear to do nothing.
      console.warn('[sttRuntime] pump error:', err);
      stopped = true;
      pending.length = 0;
      await audioCapture.stop();
      await vad.release();
      callbacks.onError(err);
    } finally {
      pumping = false;
    }
  };

  audioCapture.setSubscriber(float => {
    if (stopped) {
      return;
    }
    pending.push(float);
    pump().catch(err => console.warn('[sttRuntime] pump start:', err));
  });
  await audioCapture.start();

  return {
    stop: async (shouldFinalize = false) => {
      stopped = true;
      pending.length = 0;
      await audioCapture.stop();
      if (shouldFinalize && utterance.length > 0) {
        await finalize(true);
      }
      await vad.release();
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

    const engine = selectASREngine(settings.asrEngine);
    try {
      await engine.init();
      activeEngine = engine;

      if (settings.endpoint === 'basic') {
        active = await startBasicSession(engine, settings, callbacks);
      } else if (settings.endpoint === 'silero') {
        active = await startSileroSession(engine, settings, callbacks);
      } else {
        throw new Error(
          `[sttRuntime] unsupported endpoint '${settings.endpoint}'`,
        );
      }
    } catch (err) {
      active = null;
      activeEngine = null;
      await engine.release().catch(() => {});
      throw err;
    }
  },

  async stopSession(finalize = false): Promise<void> {
    const session = active;
    const engine = activeEngine;
    active = null;
    activeEngine = null;
    try {
      await session?.stop(finalize);
    } catch (err) {
      console.warn('[sttRuntime] session stop failed:', err);
    }
    try {
      await engine?.release();
    } catch (err) {
      console.warn('[sttRuntime] engine release failed:', err);
    }
  },

  /** Release native resources (ASR model sessions). Called on app teardown. */
  async release(): Promise<void> {
    if (active) {
      await this.stopSession();
    }
    if (activeEngine) {
      try {
        await activeEngine.release();
      } catch (err) {
        console.warn('[sttRuntime] release failed:', err);
      }
      activeEngine = null;
    }
  },
};

export * from './types';
