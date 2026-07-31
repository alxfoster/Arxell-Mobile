/**
 * Inflect audio playback.
 *
 * Reuses the speech library's native PCM player (the `RNSpeech` TurboModule's
 * `playAudio`/`stopAudio`) and its Float32→base64-Int16 converter, so Inflect
 * gets the same AudioTrack (Android) / AVAudioEngine (iOS) path + ducking as
 * the other neural engines — without depending on the library's `Speech`
 * engine registry (which is hardcoded to kokoro/supertonic/kitten/os-native).
 */

import {TurboModuleRegistry} from 'react-native';
import {Buffer} from 'buffer';

export type SilentMode = 'obey' | 'respect' | 'ignore';

export interface PlayPcmOptions {
  ducking?: boolean;
  silentMode?: SilentMode;
}

/**
 * Float32 PCM (~[-1,1]) → base64-encoded Int16 PCM.
 *
 * Inlined (instead of deep-imported from the speech library's AudioConverter)
 * so this module has no top-level dependency on the library's internals —
 * which keeps Jest imports clean and mirrors the library's exact conversion.
 */
function float32ToBase64Int16(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return Buffer.from(int16.buffer).toString('base64');
}

interface RNSpeechAudioModule {
  playAudio: (
    audioData: string,
    config: {
      sampleRate: number;
      channels: number;
      ducking?: boolean;
      silentMode?: SilentMode;
    },
  ) => Promise<void>;
  stopAudio: () => Promise<void>;
}

// The native module is registered by the autolinked speech library.
// Resolved lazily so importing this module does NOT throw in Jest (where no
// native module is registered) — only an actual play/stop call touches it.
let cached: RNSpeechAudioModule | null = null;
function getRNSpeech(): RNSpeechAudioModule {
  if (!cached) {
    cached = TurboModuleRegistry.getEnforcing(
      'RNSpeech',
    ) as unknown as RNSpeechAudioModule;
  }
  return cached;
}

/**
 * Play a Float32 PCM buffer (mono, ~[-1,1]) through the native neural-audio
 * player. Resolves when playback finishes (or is stopped).
 */
export async function playPcm(
  samples: Float32Array,
  sampleRate: number,
  options?: PlayPcmOptions,
): Promise<void> {
  const base64 = float32ToBase64Int16(samples);
  await getRNSpeech().playAudio(base64, {
    sampleRate,
    channels: 1,
    ducking: options?.ducking,
    silentMode: options?.silentMode,
  });
}

/** Stop any in-flight PCM playback. Safe when idle. */
export async function stopPcm(): Promise<void> {
  await getRNSpeech().stopAudio();
}
