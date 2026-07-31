import {Platform} from 'react-native';
import Moonshine from '@siteed/moonshine.rn';

import {
  ensureModel,
  ensureSttModelsDir,
  getModelDir,
  isModelDownloaded,
} from '../models';
import type {ASREngine, ASRStreamEvent, STTASREngineId} from '../types';
import {TranscriptAssembler} from './TranscriptAssembler';

/**
 * Moonshine ASR via @siteed/moonshine.rn (native TurboModule, MIT).
 *
 * On native it ships its own Moonshine SDK (Android `ai.moonshine:moonshine-voice`
 * AAR from Maven; iOS downloads an xcframework) — it does NOT reuse the app's
 * onnxruntime-react-native (`onnxruntime-web` is web-only). Android is
 * runtime-gated to API 35+ because the package declares minSdkVersion 35.
 *
 * Two usage modes (see ASREngine):
 *  - Offline transcribe(): the 'silero' endpoint strategy's canonical path.
 *  - Streaming (startStream/feedStream): the live dictation path. Moonshine
 *    emits revisable lines; line completion commits text but only an explicit
 *    stream flush finalizes the whole utterance.
 *
 * The production model is Moonshine tiny-streaming. Its seven required files
 * live in an architecture-specific directory (see models.ts), avoiding the
 * filename collisions that occur when offline and streaming variants share a
 * root.
 *
 * createTranscriberFromFiles return shape: README shows a transcriber
 * instance; the native spec shows {success, transcriberId}. The code below
 * handles both defensively.
 */
const MODEL_ID = 'moonshine-tiny-streaming' as const;
const MODEL_ARCH = 'tiny-streaming' as const;

type TranscriberLike = {
  transcribe?: (args: {
    input: number[];
    sampleRate: number;
  }) => Promise<{text?: string} | string>;
  createStream?: () => Promise<string>;
  startStream?: (streamId: string) => Promise<unknown>;
  stopStream?: (streamId: string) => Promise<unknown>;
  removeStream?: (streamId: string) => Promise<unknown>;
  addAudioToStream?: (
    streamId: string,
    samples: number[],
    sampleRate: number,
  ) => Promise<unknown>;
  addListener?: (cb: (e: any) => void) => () => void;
  cancel?: () => Promise<unknown>;
  release?: () => Promise<unknown>;
  releaseTranscriber?: (id: string) => Promise<unknown>;
  transcriberId?: string;
};

export class MoonshineEngine implements ASREngine {
  readonly id: STTASREngineId = 'moonshine';
  private transcriber: TranscriberLike | null = null;
  private removeListener: (() => void) | null = null;
  private activeStreamId: string | null = null;
  private readonly transcript = new TranscriptAssembler();

  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'android' && Number(Platform.Version) < 35) {
      return false;
    }
    return isModelDownloaded(MODEL_ID);
  }

  async init(): Promise<void> {
    if (this.transcriber) {
      return;
    }
    await ensureSttModelsDir();
    await ensureModel(MODEL_ID);
    // createTranscriberFromFiles({modelArch, modelPath, options}).
    // modelPath is a directory; the loader resolves arch-specific files in it.
    const result: any = await (Moonshine as any).createTranscriberFromFiles({
      modelArch: MODEL_ARCH,
      modelPath: getModelDir(MODEL_ID),
      // Let native Moonshine revise the active line frequently enough for a
      // responsive composer without invoking inference per recorder frame.
      updateIntervalMs: 300,
      options: {wordTimestamps: false},
    });
    // Defensive: README returns a transcriber; native spec returns {success, transcriberId}.
    this.transcriber =
      result &&
      typeof result === 'object' &&
      (result.transcribe || result.createStream)
        ? (result as TranscriberLike)
        : // Fallback shape — if the service returns {transcriberId} only, treat the
          // service itself as the handle (its methods accept transcriberId args).
          ((Moonshine as any as TranscriberLike) ?? null);
    if (!this.transcriber) {
      throw new Error(
        '[MoonshineEngine] createTranscriberFromFiles returned no usable handle',
      );
    }
  }

  async transcribe(samples: number[], sampleRate: number): Promise<string> {
    await this.init();
    const t = this.transcriber!;
    if (!t.transcribe) {
      throw new Error(
        '[MoonshineEngine] offline transcribe unavailable on this handle',
      );
    }
    const res = await t.transcribe({input: samples, sampleRate});
    return typeof res === 'string' ? res : (res.text ?? '');
  }

  async startStream(onEvent: (e: ASRStreamEvent) => void): Promise<string> {
    await this.init();
    const t = this.transcriber!;
    if (!t.createStream || !t.startStream || !t.addListener) {
      throw new Error('[MoonshineEngine] streaming unavailable on this handle');
    }
    const streamId = await t.createStream();
    this.transcript.reset();
    this.activeStreamId = streamId;
    // Filter both transcriber and stream IDs. A delayed event from a removed
    // stream must never overwrite the next dictation session.
    const mineId = t.transcriberId;
    this.removeListener?.();
    this.removeListener = t.addListener(event => {
      if (mineId && event?.transcriberId && event.transcriberId !== mineId) {
        return;
      }
      if (event?.streamId && event.streamId !== this.activeStreamId) {
        return;
      }
      const line = event?.line;
      switch (event?.type) {
        case 'lineStarted':
        case 'lineUpdated':
        case 'lineTextChanged':
        case 'lineCompleted': {
          if (!line?.lineId) {
            return;
          }
          const text = this.transcript.update({
            lineId: String(line.lineId),
            text: line.text ?? '',
            isFinal: event.type === 'lineCompleted' || Boolean(line.isFinal),
            startedAtMs: line.startedAtMs,
          });
          // A completed line is only a stable prefix. Silero/stopStream owns
          // utterance completion, so every native line event remains partial.
          onEvent({type: 'partial', text});
          break;
        }
        default:
          break;
      }
    });
    try {
      await t.startStream(streamId);
    } catch (err) {
      this.activeStreamId = null;
      await t.removeStream?.(streamId).catch(() => {});
      throw err;
    }
    return streamId;
  }

  async feedStream(
    streamId: string,
    samples: number[],
    sampleRate: number,
  ): Promise<void> {
    const t = this.transcriber;
    if (!t?.addAudioToStream) {
      return;
    }
    await t.addAudioToStream(streamId, samples, sampleRate);
  }

  async endStream(streamId: string): Promise<string> {
    const t = this.transcriber;
    if (!t) {
      return this.transcript.text;
    }
    try {
      await t.stopStream?.(streamId);
      // stopStream force-flushes synchronously on both native wrappers and
      // emits the final line updates before its promise resolves.
      return this.transcript.text;
    } finally {
      await t
        .removeStream?.(streamId)
        .catch(err =>
          console.warn('[MoonshineEngine] removeStream failed:', err),
        );
      if (this.activeStreamId === streamId) {
        this.activeStreamId = null;
      }
    }
  }

  async cancelStream(streamId: string): Promise<void> {
    const t = this.transcriber;
    try {
      await t?.stopStream?.(streamId);
    } catch (err) {
      console.warn('[MoonshineEngine] stopStream failed:', err);
    }
    try {
      await t?.removeStream?.(streamId);
    } catch (err) {
      console.warn('[MoonshineEngine] removeStream failed:', err);
    }
    if (this.activeStreamId === streamId) {
      this.activeStreamId = null;
    }
  }

  async release(): Promise<void> {
    this.removeListener?.();
    this.removeListener = null;
    this.activeStreamId = null;
    this.transcript.reset();
    try {
      if (
        this.transcriber?.releaseTranscriber &&
        this.transcriber.transcriberId
      ) {
        await this.transcriber.releaseTranscriber(
          this.transcriber.transcriberId,
        );
      } else {
        await this.transcriber?.release?.();
      }
    } catch (err) {
      console.warn('[MoonshineEngine] release failed:', err);
    }
    this.transcriber = null;
  }
}
