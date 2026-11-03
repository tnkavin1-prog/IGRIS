/**
 * Stateful linear resampler.
 *
 * The preferred capture context is already 16 kHz, but some devices/Chrome
 * builds force 44.1/48 kHz. This keeps the conversion correct across blocks:
 * a naive per-block resample would introduce a click at every boundary.
 */
export class StreamingResampler {
  private carry = new Float32Array(0);
  private readPosition = 0;

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {
    if (fromRate <= 0 || toRate <= 0) throw new Error('Sample rates must be positive.');
  }

  get passthrough(): boolean {
    return this.fromRate === this.toRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.passthrough) return input;
    if (input.length === 0) return new Float32Array(0);

    const combined = new Float32Array(this.carry.length + input.length);
    combined.set(this.carry, 0);
    combined.set(input, this.carry.length);

    const ratio = this.fromRate / this.toRate;
    const available = combined.length;
    const outputLength = Math.max(0, Math.floor((available - 1 - this.readPosition) / ratio));
    const out = new Float32Array(outputLength);
    let position = this.readPosition;
    for (let i = 0; i < outputLength; i += 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      const a = combined[index] ?? 0;
      const b = combined[index + 1] ?? a;
      out[i] = a + (b - a) * fraction;
      position += ratio;
    }

    const consumed = Math.floor(position);
    this.carry = combined.slice(consumed);
    this.readPosition = position - consumed;
    return out;
  }

  reset(): void {
    this.carry = new Float32Array(0);
    this.readPosition = 0;
  }
}

/** One-shot helper used for tests and still-image audio. */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  return new StreamingResampler(fromRate, toRate).process(input);
}
