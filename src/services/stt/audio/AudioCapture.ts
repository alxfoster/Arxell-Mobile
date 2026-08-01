import {PermissionsAndroid, Platform} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';

/**
 * Mic capture via react-native-live-audio-stream. Emits 16 kHz mono PCM as
 * normalized float [-1, 1] (for Silero VAD + Moonshine) and raw Int16 (kept
 * for any consumer that wants it).
 *
 * 16 kHz / mono / 16-bit matches both Silero VAD and Moonshine input exactly.
 * audioSource 7 = VOICE_COMMUNICATION (Android) — speech-tuned processing
 * plus platform acoustic echo cancellation where the device supports it.
 * Echo cancellation is essential while hands-free capture overlaps TTS.
 *
 * Permission: Android uses RN's built-in PermissionsAndroid (no extra dep);
 * iOS relies on the NSMicrophoneUsageDescription key + the auto-prompt on
 * first mic access.
 */

const STOP_TIMEOUT_MS = 1500;

const OPTIONS = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  audioSource: 7,
  wavFile: 'stt-live-audio.wav',
  bufferSize: 1024, // ~512 samples (32 ms) — VAD-friendly granularity
};

export type PCMSubscriber = (
  samplesFloat: Float32Array,
  samplesInt16: Int16Array,
) => void;

let initialized = false;
let subscriber: PCMSubscriber | null = null;

// Minimal base64 -> bytes. RN has no global atob/Buffer guarantee, and we
// don't want to add the `buffer` package just for this.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const out: number[] = [];
  let bits = 0;
  let n = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') {
      break;
    }
    const v = B64.indexOf(c);
    if (v < 0) {
      continue;
    }
    bits = bits * 64 + v;
    n += 6;
    if (n >= 8) {
      n -= 8;
      const divisor = 2 ** n;
      out.push(Math.floor(bits / divisor) % 256);
      bits %= divisor;
    }
  }
  return new Uint8Array(out);
}

function decodePCM16LE(b64: string): {float: Float32Array; int16: Int16Array} {
  const bytes = base64ToBytes(b64);
  const count = Math.floor(bytes.length / 2);
  const int16 = new Int16Array(count);
  const float = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let s = hi * 256 + lo;
    if (s >= 0x8000) {
      s -= 0x10000; // sign-extend
    }
    int16[i] = s;
    float[i] = s / 32768;
  }
  return {float, int16};
}

export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true; // iOS auto-prompts via NSMicrophoneUsageDescription
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'Arxell needs microphone access for voice input.',
      buttonNeutral: 'Ask Me Later',
      buttonNegative: 'Cancel',
      buttonPositive: 'OK',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export const audioCapture = {
  init() {
    if (initialized) {
      return;
    }
    LiveAudioStream.init(OPTIONS);
    LiveAudioStream.on('data', (data: string) => {
      if (!subscriber) {
        return;
      }
      const {float, int16} = decodePCM16LE(data);
      subscriber(float, int16);
    });
    initialized = true;
  },

  setSubscriber(fn: PCMSubscriber | null) {
    subscriber = fn;
  },

  async start() {
    if (!initialized) {
      this.init();
    }
    await LiveAudioStream.start();
  },

  async stop() {
    // Detach first: some Android implementations do not settle stop() when it
    // is requested near a native data event. No more PCM should reach the VAD
    // while shutdown is pending.
    subscriber = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        LiveAudioStream.stop().then(() => 'stopped' as const),
        new Promise<'timeout'>(resolve => {
          timer = setTimeout(() => resolve('timeout'), STOP_TIMEOUT_MS);
        }),
      ]);
      if (outcome === 'timeout') {
        console.warn('[audioCapture] stop timed out');
      }
    } catch (err) {
      console.warn('[audioCapture] stop failed:', err);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  },
};
