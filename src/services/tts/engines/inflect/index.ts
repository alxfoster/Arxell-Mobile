import {Platform} from 'react-native';

import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  INFLECT_MODEL_BASE_URL,
  INFLECT_MODEL_FILES,
  INFLECT_MODEL_SUBDIR,
  INFLECT_SAMPLE_RATE,
  TTS_DICT_FILENAME,
  TTS_DICT_URL,
  TTS_PARENT_SUBDIR,
} from '../../constants';
import {ttsRuntime} from '../../runtime';
import type {Engine, StreamingHandle, Voice} from '../../types';
import {playPcm, stopPcm} from './audio';
import {
  type Phonemizer,
  normalizeText,
  splitText,
} from './frontend';
import {InflectInference} from './inference';
import {INFLECT_VOICES} from './voices';
import {createInflectPhonemizer} from './espeakFrontend';

export type InflectProgressCallback = (progress: number) => void;

/**
 * Inflect-Nano-v2 neural TTS engine (4M-param VITS, ~16 MB, English, single
 * fixed voice).
 *
 * Unlike the other neural engines, Inflect does NOT route through the speech
 * library's `Speech` engine registry (which is hardcoded to
 * kokoro/supertonic/kitten/os-native). Instead it runs the two ONNX graphs
 * itself via `onnxruntime-react-native` and plays the resulting PCM through
 * the library's native audio player (`RNSpeech.playAudio`).
 *
 * Frontend: the reference runner phonemizes with eSpeak-ng. This spike
 * injects the library's existing JS phonemizer (EPD1 dict + hans00 fallback)
 * as an approximation — intelligible but not reference-quality. Swapping in a
 * native eSpeak-ng frontend is the planned quality upgrade.
 *
 * Installation is a single-phase all-or-nothing download (duration.onnx,
 * decode.onnx, IPA dict). On any failure the whole `tts/inflect/` directory
 * is removed so a retry starts clean. CPU-only, matching the other engines.
 */
export class InflectEngine implements Engine {
  readonly id = 'inflect' as const;

  private readonly inference = new InflectInference();
  private phonemizeFn: Phonemizer | null = null;

  /** Set true by stop(); the synthesis loop checks it between chunks. */
  private cancelled = false;

  private getParentDir(): string {
    const root =
      Platform.OS === 'ios'
        ? `${RNFS.LibraryDirectoryPath}/Application Support`
        : RNFS.DocumentDirectoryPath;
    return `${root}/${TTS_PARENT_SUBDIR}`;
  }

  getModelPath(): string {
    const root =
      Platform.OS === 'ios'
        ? `${RNFS.LibraryDirectoryPath}/Application Support`
        : RNFS.DocumentDirectoryPath;
    return `${root}/${INFLECT_MODEL_SUBDIR}`;
  }

  private getFilePath(filename: string): string {
    return `${this.getModelPath()}/${filename}`;
  }

  async isInstalled(): Promise<boolean> {
    try {
      for (const file of INFLECT_MODEL_FILES) {
        if (!(await RNFS.exists(this.getFilePath(file.name)))) {
          return false;
        }
      }
      return RNFS.exists(this.getFilePath(TTS_DICT_FILENAME));
    } catch (err) {
      console.warn('[InflectEngine] isInstalled check failed:', err);
      return false;
    }
  }

  async getVoices(): Promise<Voice[]> {
    return INFLECT_VOICES;
  }

  async downloadModel(onProgress?: InflectProgressCallback): Promise<void> {
    const parentDir = this.getParentDir();
    const modelDir = this.getModelPath();

    await RNFS.mkdir(parentDir, {NSURLIsExcludedFromBackupKey: true});
    await RNFS.mkdir(modelDir, {NSURLIsExcludedFromBackupKey: true});

    const allFiles = [
      ...INFLECT_MODEL_FILES.map(f => ({
        name: f.name,
        url: `${INFLECT_MODEL_BASE_URL}/${f.urlPath}`,
      })),
      {name: TTS_DICT_FILENAME, url: TTS_DICT_URL},
    ];
    const perFile = new Array(allFiles.length).fill(0);
    const report = () => {
      if (!onProgress) {
        return;
      }
      const sum = perFile.reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, sum / allFiles.length));
    };

    try {
      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i]!;
        const target = this.getFilePath(file.name);
        const result = await RNFS.downloadFile({
          fromUrl: file.url,
          toFile: target,
          background: false,
          discretionary: false,
          cacheable: false,
          progressInterval: 500,
          progress: res => {
            const contentLength = res.contentLength || 1;
            perFile[i] = Math.min(1, res.bytesWritten / contentLength);
            report();
          },
        }).promise;

        if (result.statusCode !== 200) {
          throw new Error(
            `Failed to download ${file.name}: HTTP ${result.statusCode}`,
          );
        }
        perFile[i] = 1;
        report();
      }
      if (onProgress) {
        onProgress(1);
      }
    } catch (err) {
      try {
        if (await RNFS.exists(modelDir)) {
          await RNFS.unlink(modelDir);
        }
      } catch (cleanupErr) {
        console.warn('[InflectEngine] partial-download cleanup failed:', cleanupErr);
      }
      throw err;
    }
  }

  async deleteModel(): Promise<void> {
    try {
      if (await RNFS.exists(this.getModelPath())) {
        await RNFS.unlink(this.getModelPath());
      }
    } catch (err) {
      console.warn('[InflectEngine] deleteModel failed:', err);
    }
  }

  /**
   * Load the ONNX sessions and prepare the phonemizer. Called by
   * `ttsRuntime.acquire` when Inflect becomes the active engine.
   */
  async loadInto(): Promise<void> {
    const modelDir = this.getModelPath();

    // Phonemizer: native eSpeak-ng first (reference quality, what Inflect
    // was trained on); JS phonemizer fallback otherwise. See espeakFrontend.
    this.phonemizeFn = await createInflectPhonemizer(
      this.getFilePath(TTS_DICT_FILENAME),
    );

    await this.inference.load(
      `file://${modelDir}/duration.onnx`,
      `file://${modelDir}/decode.onnx`,
    );

    this.cancelled = false;
  }

  /** Release native ONNX resources (best-effort). */
  async release(): Promise<void> {
    await this.inference.release();
    this.phonemizeFn = null;
  }

  async play(text: string, voice: Voice): Promise<void> {
    if (!(await this.isInstalled())) {
      throw new Error('Inflect model is not installed');
    }
    await ttsRuntime.acquire(this, async () => {
      if (!this.phonemizeFn) {
        throw new Error('[InflectEngine] phonemizer not initialized');
      }
      this.cancelled = false;
      const samples = await this.inference.synthesize(text, {
        phonemize: this.phonemizeFn,
      });
      if (this.cancelled) {
        return;
      }
      await playPcm(samples, INFLECT_SAMPLE_RATE, {
        ducking: true,
        silentMode: 'obey',
      });
    });
  }

  /**
   * Sentence-buffered streaming: text is accumulated and flushed on sentence
   * boundaries (. ! ? ; :) so the first sentence plays while the LLM keeps
   * streaming. Flushes are serialized so sentences play in order. This is a
   * lighter-weight substitute for the library's `createSpeechStream` (which
   * is bound to the Speech engine registry Inflect doesn't use).
   */
  playStreaming(voice: Voice, waitFor?: Promise<void>): StreamingHandle {
    // Capture the engine so the handle's methods (whose `this` is the handle,
    // not the engine) can reach engine state.
    const engine = this;
    let dead = false;
    let buffer = '';
    let chain: Promise<void> = Promise.resolve();

    const flush = (chunk: string): Promise<void> => {
      if (!chunk.trim()) {
        return Promise.resolve();
      }
      chain = chain.then(async () => {
        if (dead || this.cancelled) {
          return;
        }
        await this.play(chunk, voice);
      });
      return chain;
    };

    const ready = (waitFor ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (dead) {
          return;
        }
        // Front-load engine load so the first sentence plays with lower
        // latency once it arrives. Later flushes' `play()` re-acquire but
        // skip loadInto (engine already active).
        return ttsRuntime.acquire(engine, async () => {
          /* pre-load only */
        });
      })
      .catch(err => {
        console.warn('[InflectEngine] streaming acquire failed:', err);
      });

    return {
      appendText(chunk: string) {
        if (dead) {
          return;
        }
        buffer += chunk;
        // Flush complete sentences as they arrive (low-latency first speech).
        const parts = buffer.split(/(?<=[.!?;:])\s+/);
        if (parts.length > 1) {
          buffer = parts.pop() ?? '';
          for (const sentence of parts) {
            if (sentence.trim()) {
              flush(sentence.trim());
            }
          }
        }
      },
      async finalize() {
        if (dead) {
          return;
        }
        await ready;
        const remaining = buffer.trim();
        buffer = '';
        if (remaining) {
          await flush(remaining);
        }
        await chain;
      },
      async cancel() {
        dead = true;
        engine.cancelled = true;
        buffer = '';
        try {
          await stopPcm();
        } catch {
          /* swallow */
        }
        chain = Promise.resolve();
      },
    };
  }

  async stop(): Promise<void> {
    this.cancelled = true;
    await stopPcm();
  }
}

/** Re-export for callers that want the catalog directly. */
export {INFLECT_VOICES} from './voices';
