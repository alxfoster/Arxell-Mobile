import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Native eSpeak-ng phonemizer (Android only).
 *
 * Backs the Inflect engine's frontend with the same espeak-ng (en-us, IPA,
 * with stress) phonemization the Inflect-Nano-v2 model was trained on. iOS
 * support is a follow-up; the engine falls back to the JS phonemizer when
 * this module is unavailable.
 *
 * On first call the Kotlin side extracts the bundled espeak-ng-data assets
 * to the app's files dir and initializes the engine.
 */
export interface Spec extends TurboModule {
  /** Phonemize text → IPA string (en-us, stress + punctuation preserved). */
  phonemize(text: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('EspeakNg');
