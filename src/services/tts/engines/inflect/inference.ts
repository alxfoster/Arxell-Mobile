/**
 * Inflect-Nano-v2 ONNX inference.
 *
 * Runs the two-graph VITS pipeline:
 *
 *   duration.onnx : tokens + length_scale → (m_p_exp, logs_p_exp, y_mask)
 *   decode.onnx   : those + seeded noise (zp_noise) + noise_scale → waveform
 *
 * The seeded Gaussian noise is generated in JS (mulberry32 + Box–Muller).
 * The reference runner uses NumPy's PCG64; we do NOT reproduce that bit
 * stream, so on-device output differs from the Python golden in timbre but
 * not in correctness. (Parity tests feed a precomputed noise tensor to
 * isolate ONNX-run correctness from the RNG — see /tmp/inflect/golden.)
 */

import {InferenceSession, Tensor} from 'onnxruntime-react-native';

import {
  type Phonemizer,
  edgeFade,
  joinWithPauses,
  normalizeText,
  phonemesToTokens,
  splitText,
} from './frontend';
import {INFLECT_SAMPLE_RATE} from '../../constants';

export interface SynthesizeOptions {
  /** Phonemizer (text → IPA). Injected by the engine. */
  phonemize: Phonemizer;
  /** Speech rate multiplier, 0.5–2.0 (reference default 1.0). */
  speed?: number;
  /** Stochastic variation / noise scale, 0.0–1.0 (reference default 0.667). */
  variation?: number;
  /** Deterministic seed (reference default 0). */
  seed?: number;
}

/** Deterministic seeded PRNG (mulberry32) — good enough for latent noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fill `out` with standard-normal samples via Box–Muller, seeded by `seed`.
 * Mirrors `np.random.default_rng(seed).standard_normal(shape)`.
 */
function standardNormalInto(out: Float32Array, seed: number): void {
  const rand = mulberry32(seed);
  const n = out.length;
  let i = 0;
  while (i < n) {
    // Avoid u1 == 0 → log(0).
    let u1 = rand();
    if (u1 < 1e-12) {
      u1 = 1e-12;
    }
    const u2 = rand();
    const r = Math.sqrt(-2.0 * Math.log(u1));
    const theta = 2.0 * Math.PI * u2;
    out[i] = r * Math.cos(theta);
    if (i + 1 < n) {
      out[i + 1] = r * Math.sin(theta);
    }
    i += 2;
  }
}

const melChannels = 128;

export class InflectInference {
  private duration: InferenceSession | null = null;
  private decode: InferenceSession | null = null;

  /** True once both ONNX sessions are loaded. */
  get isLoaded(): boolean {
    return this.duration !== null && this.decode !== null;
  }

  async load(durationPath: string, decodePath: string): Promise<void> {
    // Release any prior sessions first (bounds RAM leakage across re-loads —
    // the app-level runtime has no per-engine release hook for non-Speech
    // engines, so loadInto() is our only lifecycle entry point).
    await this.release();
    // CPU-only, matching the other neural engines for battery/thermal/QA.
    this.duration = await InferenceSession.create(durationPath, {
      executionProviders: ['cpu'],
    });
    this.decode = await InferenceSession.create(decodePath, {
      executionProviders: ['cpu'],
    });
  }

  async release(): Promise<void> {
    // InferenceSession.release() frees native ORT resources.
    try {
      await this.duration?.release();
    } catch {
      /* swallow — best-effort teardown */
    }
    try {
      await this.decode?.release();
    } catch {
      /* swallow */
    }
    this.duration = null;
    this.decode = null;
  }

  /**
   * Synthesize a (possibly multi-sentence) text to a 24 kHz mono Float32
   * waveform in roughly [-1, 1]. Port of `InflectONNX.synthesize`.
   */
  async synthesize(text: string, opts: SynthesizeOptions): Promise<Float32Array> {
    if (!this.duration || !this.decode) {
      throw new Error('[InflectInference] not loaded — call load() first');
    }
    const speed = opts.speed ?? 1.0;
    const variation = opts.variation ?? 0.667;
    const seed = opts.seed ?? 0;

    const normalized = normalizeText(text);
    if (!normalized) {
      throw new Error('[InflectInference] text must not be empty');
    }

    const chunks = splitText(normalized);
    const pieces: Float32Array[] = [];
    const endings: string[] = [];

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      const phonemes = await opts.phonemize(chunk);
      const tokens = phonemesToTokens(phonemes);
      if (tokens.length === 0) {
        // No speakable tokens for this chunk — emit a short silence.
        pieces.push(new Float32Array(Math.round(INFLECT_SAMPLE_RATE * 0.1)));
        endings.push(chunk.slice(-1));
        continue;
      }

      // --- duration.onnx ---
      const dur = await this.duration.run(
        {
          tokens: new Tensor('int64', tokens, [1, tokens.length]),
          lengths: new Tensor('int64', BigInt64Array.of(BigInt(tokens.length)), [1]),
          length_scale: new Tensor('float32', new Float32Array([1.0 / speed]), []),
        },
        ['m_p_exp', 'logs_p_exp', 'y_mask'],
      );
      const m_p = dur.m_p_exp;
      const logs_p = dur.logs_p_exp;
      const y_mask = dur.y_mask;
      const melLen = (m_p.dims[2] as number) ?? 0;
      if (melLen <= 0) {
        throw new Error('[InflectInference] duration produced empty mel');
      }

      // --- seeded latent noise (same shape as m_p_exp) ---
      const noiseData = new Float32Array(melChannels * melLen);
      standardNormalInto(noiseData, seed + index);

      // --- decode.onnx ---
      const dec = await this.decode.run(
        {
          m_p_exp: m_p,
          logs_p_exp: logs_p,
          y_mask: y_mask,
          zp_noise: new Tensor('float32', noiseData, [1, melChannels, melLen]),
          noise_scale: new Tensor('float32', new Float32Array([variation]), []),
        },
        ['waveform'],
      );
      const wavTensor = dec.waveform;
      const wav = wavTensor.data as Float32Array; // shape [1, 1, wav_len]

      pieces.push(edgeFade(wav));
      endings.push(chunk.slice(-1));
    }

    const joined = joinWithPauses(pieces, endings);

    // Clip to [-1, 1] — matches the reference final step.
    for (let i = 0; i < joined.length; i++) {
      if (joined[i]! > 1) {
        joined[i] = 1;
      } else if (joined[i]! < -1) {
        joined[i] = -1;
      }
    }
    return joined;
  }
}
