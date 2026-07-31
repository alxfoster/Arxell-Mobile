/**
 * Fixed-duration rolling PCM buffer used to preserve speech that arrives just
 * before VAD crosses its start threshold. Without this, quiet initial
 * consonants (for example the "h" in "hello") are clipped from the ASR input.
 */
export class AudioPreRoll {
  private readonly samples: number[] = [];

  constructor(private readonly capacitySamples: number) {}

  append(chunk: Float32Array): void {
    if (this.capacitySamples <= 0 || chunk.length === 0) {
      return;
    }

    // If one capture chunk is larger than the entire window, only its tail can
    // possibly survive in the rolling buffer.
    const start = Math.max(0, chunk.length - this.capacitySamples);
    for (let i = start; i < chunk.length; i++) {
      this.samples.push(chunk[i]);
    }

    const overflow = this.samples.length - this.capacitySamples;
    if (overflow > 0) {
      this.samples.splice(0, overflow);
    }
  }

  /** Append the buffered samples to an utterance in chronological order. */
  drainInto(target: number[]): void {
    for (let i = 0; i < this.samples.length; i++) {
      target.push(this.samples[i]);
    }
    this.samples.length = 0;
  }

  clear(): void {
    this.samples.length = 0;
  }

  get length(): number {
    return this.samples.length;
  }
}
