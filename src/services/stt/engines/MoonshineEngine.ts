import {Platform} from 'react-native';
import Moonshine from '@siteed/moonshine.rn';

import {
  ensureModel,
  ensureSttModelsDir,
  isModelDownloaded,
  sttModelsDir,
} from '../models';
import type {ASREngine, ASRStreamEvent, STTASREngineId} from '../types';

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
 *  - Streaming (startStream/feedStream): the 'basic' endpoint strategy, where
 *    Moonshine's own VAD + streaming emits partial/final line events.
 *
 * ⚠️ LIKELY NEEDS RUNTIME TUNING:
 *  - MODEL_ARCH: 'base' for offline. The streaming path may require
 *    'base-streaming' model files — if createStream()/addAudioToStream()
 *    errors, switch MODEL_ARCH and host the corresponding files.
 *  - modelPath: createTranscriberFromFiles expects a *directory*; confirm the
 *    files/filenames Moonshine's loader wants match what you host in
 *    sttModelsDir() (see models.ts).
 *  - createTranscriberFromFiles return shape: README shows a transcriber
 *    instance; the native spec shows {success, transcriberId}. The code below
 *    handles both defensively.
 */
const MODEL_ARCH = 'base' as const;

type TranscriberLike = {
  transcribe?: (args: {
    input: number[];
    sampleRate: number;
  }) => Promise<{text?: string} | string>;
  createStream?: () => Promise<string>;
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

  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'android' && Number(Platform.Version) < 35) {
      return false;
    }
    return isModelDownloaded('moonshine-base');
  }

  async init(): Promise<void> {
    if (this.transcriber) {
      return;
    }
    await ensureSttModelsDir();
    await ensureModel('moonshine-base');
    // createTranscriberFromFiles({modelArch, modelPath, options}).
    // modelPath is a directory; the loader resolves arch-specific files in it.
    const result: any = await (Moonshine as any).createTranscriberFromFiles({
      modelArch: MODEL_ARCH,
      modelPath: sttModelsDir(),
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
    if (!t.createStream || !t.addListener) {
      throw new Error('[MoonshineEngine] streaming unavailable on this handle');
    }
    const streamId = await t.createStream();
    // Relay Moonshine line events -> ASRStreamEvent. Filter by transcriberId
    // when present so concurrent transcribers don't cross-talk.
    const mineId = t.transcriberId;
    this.removeListener?.();
    this.removeListener = t.addListener(event => {
      if (mineId && event?.transcriberId && event.transcriberId !== mineId) {
        return;
      }
      const text: string = event?.line?.text ?? '';
      switch (event?.type) {
        case 'lineStarted':
          onEvent({type: 'partial', text: ''});
          break;
        case 'lineUpdated':
        case 'lineTextChanged':
          onEvent({type: 'partial', text});
          break;
        case 'lineCompleted':
          onEvent({type: 'final', text});
          break;
        default:
          break;
      }
    });
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

  async endStream(_streamId: string): Promise<void> {
    // Moonshine finalizes via the lineCompleted event; nothing to await here.
  }

  async cancelStream(_streamId: string): Promise<void> {
    try {
      await this.transcriber?.cancel?.();
    } catch (err) {
      console.warn('[MoonshineEngine] cancel failed:', err);
    }
  }

  async release(): Promise<void> {
    this.removeListener?.();
    this.removeListener = null;
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
