/**
 * Inflect-Nano-v2 text frontend + waveform post-processing.
 *
 * Pure ports of the reference ONNX runner (`inference_onnx.py`): text
 * normalization, punctuation-aware chunking, symbol→token mapping with
 * VITS blank-insertion, inter-chunk boundary pauses, and edge fades.
 *
 * The one piece that is NOT pure — grapheme-to-phoneme conversion — is
 * injected by the engine as a `Phonemizer` so the frontend stays testable
 * and the phonemizer backend (JS dict today, eSpeak-ng later) is swappable.
 *
 * NOTE: the reference runner phonemizes with eSpeak-ng. We currently inject
 * the library's existing JS phonemizer (hans/dict) as an approximation —
 * see `InflectEngine`. Output will be intelligible but not byte-identical to
 * the reference until a native eSpeak-ng frontend lands.
 */

import {SYMBOL_TO_ID} from './symbols';
import {INFLECT_SAMPLE_RATE} from '../../constants';

/** Whitespace normalizer — matches the reference `synthesize()` prelude. */
export function normalizeText(text: string): string {
  return text.split(/\s+/).join(' ').trim();
}

/**
 * Map a phoneme string to VITS token IDs with a leading/trailing/inter-token
 * blank (`_`, id 0) inserted between every symbol — the `add_blank=True`
 * layout the duration predictor was trained on.
 *
 * Returns a BigInt64Array because ONNX `tokens` is int64 and the speech
 * library's proven pattern feeds int64 via BigInt64Array.
 *
 * Symbols not in the vocab are dropped (the JS-phonemizer spike can emit
 * characters outside the keithito symbol set; dropping is safer than
 * mis-tokenizing).
 */
export function phonemesToTokens(phonemeText: string): BigInt64Array {
  const ids: number[] = [];
  for (const ch of Array.from(phonemeText)) {
    const id = SYMBOL_TO_ID.get(ch);
    if (id !== undefined) {
      ids.push(id);
    }
  }
  if (ids.length === 0) {
    return new BigInt64Array(0);
  }
  // Interleave blanks: [0, s0, 0, s1, ..., 0, sN, 0]  (len = 2N+1)
  const withBlanks = new BigInt64Array(ids.length * 2 + 1);
  for (let i = 0; i < ids.length; i++) {
    withBlanks[i * 2 + 1] = BigInt(ids[i]!);
  }
  return withBlanks;
}

/**
 * Punctuation-aware chunking — straight port of the reference `split_text`.
 * Splits on sentence-final punctuation, then hard-wraps over-long sentences
 * at comma/colon/space boundaries. 280-char default matches the reference.
 */
export function splitText(text: string, limit = 280): string[] {
  const normalized = text.split(/\s+/).join(' ');
  const sentences = normalized
    .split(/(?<=[.!?;:])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const chunks: string[] = [];
  for (const sentence of sentences.length ? sentences : [normalized]) {
    let remaining = sentence;
    while (remaining.length > limit) {
      const search = remaining.slice(0, limit + 1);
      const comma = search.lastIndexOf(',');
      const semi = search.lastIndexOf(';');
      const colon = search.lastIndexOf(':');
      const punctuation = Math.max(comma, semi, colon);
      const splitAt =
        punctuation >= limit / 2
          ? punctuation + 1
          : remaining.lastIndexOf(' ', limit);
      const at = splitAt < limit / 2 ? limit : splitAt;
      const head = remaining.slice(0, at).trim();
      if (head) {
        chunks.push(head);
      }
      remaining = remaining.slice(at).trim();
    }
    if (remaining) {
      chunks.push(remaining);
    }
  }
  return chunks;
}

/** Boundary pause (seconds) after a chunk ending in `endingChar`. */
export function boundaryPauseSeconds(endingChar: string): number {
  switch (endingChar) {
    case '?':
      return 0.28;
    case '!':
      return 0.24;
    case '.':
      return 0.22;
    case ';':
      return 0.16;
    case ':':
      return 0.13;
    case ',':
      return 0.09;
    default:
      return 0.08;
  }
}

/**
 * 5 ms raised-cosine edge fade to prevent chunk-concatenation clicks.
 * Port of the reference `edge_fade`.
 */
export function edgeFade(
  waveform: Float32Array,
  sampleRate = INFLECT_SAMPLE_RATE,
  milliseconds = 5.0,
): Float32Array {
  const frames = Math.min(
    Math.round((sampleRate * milliseconds) / 1000),
    Math.floor(waveform.length / 2),
  );
  if (frames <= 0) {
    return waveform;
  }
  const out = new Float32Array(waveform.length);
  out.set(waveform);
  for (let i = 0; i < frames; i++) {
    const ramp = i / (frames - 1);
    out[i] = waveform[i]! * ramp;
    out[waveform.length - 1 - i] = waveform[waveform.length - 1 - i]! * ramp;
  }
  return out;
}

/** Concatenate synthesis pieces with boundary pauses between chunks. */
export function joinWithPauses(
  pieces: Float32Array[],
  chunkEndings: string[],
  sampleRate = INFLECT_SAMPLE_RATE,
): Float32Array {
  const segments: Float32Array[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      const pause = boundaryPauseSeconds(chunkEndings[i - 1] ?? '');
      const silence = new Float32Array(Math.round(sampleRate * pause));
      segments.push(silence);
    }
    segments.push(pieces[i]!);
  }
  // Flatten.
  const total = segments.reduce((n, s) => n + s.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const s of segments) {
    out.set(s, offset);
    offset += s.length;
  }
  return out;
}

/** Phonemizer contract — text → IPA string. Injected by the engine. */
export type Phonemizer = (text: string) => Promise<string>;
