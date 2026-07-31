import type {Voice} from '../../types';

/**
 * Inflect-Nano-v2 voice catalog.
 *
 * Inflect is a single fixed voice (deterministic via seed), so the catalog
 * is one entry. The `id` is passed to the engine but has no per-voice
 * resource to load — it exists so the shared voice/store UI has a stable
 * identifier to select and persist.
 */
export const INFLECT_VOICES: Voice[] = [
  {
    id: 'inflect-nano-v2',
    name: 'Inflect Nano',
    engine: 'inflect',
    language: 'en',
  },
];
