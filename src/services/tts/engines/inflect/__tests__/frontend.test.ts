import {SYMBOLS, VOCAB_SIZE} from '../symbols';
import {edgeFade, phonemesToTokens, splitText} from '../frontend';

/**
 * Parity tests for the Inflect-Nano-v2 frontend against an INDEPENDENT
 * Python reference (the model's own `inference_onnx.py` + `symbols.py`).
 *
 * The golden token sequence below was computed in Python from the model's
 * authoritative symbol table for a fixed phoneme string, then captured to
 * `/tmp/inflect/golden/parity.json`. If the JS port drifts (symbol order,
 * blank-insertion, filtering), this test fails.
 */

// Golden: Python `phonemes_to_tokens` output for the phoneme string below.
const GOLDEN_PHONEMES = 'həˈloʊ, ðˈɪs ɪz ɐ tˈɛst ʌv ˈɪnflekt spitʃ.';
const GOLDEN_TOKENS = [
  0, 50, 0, 83, 0, 156, 0, 54, 0, 57, 0, 135, 0, 3, 0, 16, 0, 81, 0, 156, 0,
  102, 0, 61, 0, 16, 0, 102, 0, 68, 0, 16, 0, 70, 0, 16, 0, 62, 0, 156, 0, 86,
  0, 61, 0, 62, 0, 16, 0, 138, 0, 64, 0, 16, 0, 156, 0, 102, 0, 56, 0, 48, 0,
  54, 0, 47, 0, 53, 0, 62, 0, 16, 0, 61, 0, 58, 0, 51, 0, 62, 0, 131, 0, 4, 0,
];

describe('Inflect symbols', () => {
  it('matches the model vocabulary size (178)', () => {
    expect(VOCAB_SIZE).toBe(178);
    expect(SYMBOLS.length).toBe(178);
  });

  it('pad is id 0 and space is its own id (keithito layout)', () => {
    expect(SYMBOLS[0]).toBe('_');
    // SPACE_ID is the index of ' ' in the original symbols list.
    expect(SYMBOLS.indexOf(' ')).toBeGreaterThan(0);
  });
});

describe('Inflect phonemesToTokens (Python parity)', () => {
  it('produces the exact blank-interleaved token sequence', () => {
    const tokens = phonemesToTokens(GOLDEN_PHONEMES);
    expect(tokens.length).toBe(GOLDEN_TOKENS.length);
    const asNumbers = Array.from(tokens).map(b => Number(b));
    expect(asNumbers).toEqual(GOLDEN_TOKENS);
  });

  it('every even index is a blank (id 0)', () => {
    const tokens = phonemesToTokens(GOLDEN_PHONEMES);
    for (let i = 0; i < tokens.length; i += 2) {
      expect(Number(tokens[i])).toBe(0);
    }
  });

  it('drops out-of-vocab characters instead of mis-tokenizing', () => {
    // '@' and '*' are not in the symbol set; surrounding IPA is preserved.
    // h, ə, l, o, ʊ are in-vocab (5 ids); '@' is dropped.
    // 5 ids → 2*5+1 = 11 blank-interleaved tokens.
    const tokens = phonemesToTokens('hə@loʊ');
    expect(tokens.length).toBe(11);
  });
});

describe('Inflect splitText', () => {
  it('splits on sentence-final punctuation', () => {
    const chunks = splitText('Hello world. How are you?');
    expect(chunks).toEqual(['Hello world.', 'How are you?']);
  });

  it('hard-wraps over-long sentences at spaces', () => {
    const long = `word `.repeat(60).trim() + '.';
    const chunks = splitText(long, 280);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(280);
    }
  });
});

describe('Inflect edgeFade', () => {
  it('fades the first and last frames toward zero', () => {
    const wav = new Float32Array(1000).fill(1);
    const faded = edgeFade(wav, 24000, 5);
    // 5ms @ 24kHz = 120 frames.
    expect(faded[0]).toBeCloseTo(0, 5);
    expect(faded[119]).toBeCloseTo(1, 5);
    expect(faded[faded.length - 1]).toBeCloseTo(0, 5);
    expect(faded[faded.length - 120]).toBeCloseTo(1, 5);
  });
});
