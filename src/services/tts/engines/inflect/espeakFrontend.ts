/**
 * Inflect phonemizer factory — native eSpeak-ng first, JS fallback second.
 *
 * The Inflect-Nano-v2 model was trained on eSpeak-ng (en-us, IPA, with
 * stress) phonemes. The native `EspeakNg` TurboModule (Android) produces
 * exactly that, so we prefer it. On iOS, in tests, or if native init fails,
 * we fall back to the speech library's JS phonemizer (EPD1 dict + hans00) —
 * intelligible but approximate.
 */
import {Platform} from 'react-native';

import type {Phonemizer} from './frontend';

/**
 * Build the Inflect phonemizer for the current platform.
 *
 * @param dictPath absolute path to `en-us.bin` (used only by the JS fallback).
 */
export async function createInflectPhonemizer(dictPath: string): Promise<Phonemizer> {
  // 1. Native eSpeak-ng (Android) — reference quality.
  if (Platform.OS === 'android') {
    try {
      // Lazy require so this module imports cleanly in Jest and when the
      // native module isn't registered (iOS). The probe also triggers the
      // Kotlin side's lazy data-extract + nativeInit on first use.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NativeEspeakNg = require('../../../../specs/NativeEspeakNg').default;
      const probe = await NativeEspeakNg.phonemize('ready');
      if (probe && probe.length > 0) {
        return async (text: string) => {
          const ph = await NativeEspeakNg.phonemize(text);
          // Empty result would yield no tokens; pass text through so the
          // caller can decide (and the tokenizer drops unknown chars).
          return ph.length > 0 ? ph : text;
        };
      }
    } catch (e) {
      console.warn(
        '[Inflect] native eSpeak-ng unavailable, using JS phonemizer fallback:',
        e,
      );
    }
  }

  // 2. JS fallback (hans/dict phonemizer shared with Kokoro/Kitten).
  // @ts-ignore - deep import into the library's compiled phonemization module
  const {HansPhonemizer, openNativeDict} = require('@pocketpalai/react-native-speech/lib/module/phonemization');
  const dictSource = await openNativeDict(dictPath);
  const phonemizer = new HansPhonemizer({dict: dictSource});
  return (text: string) => phonemizer.phonemize(text, 'en-us');
}
