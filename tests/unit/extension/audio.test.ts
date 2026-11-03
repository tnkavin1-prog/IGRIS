import { describe, expect, it } from 'vitest';
import {
  base64PcmToFloat,
  base64ToBytes,
  base64ToInt16,
  bytesToBase64,
  clampSample,
  concatInt16,
  floatToPcm16,
  int16Rms,
  int16ToBase64,
  pcm16ToFloat,
  rms,
} from '../../../apps/chrome-extension/src/audio/pcm.js';
import {
  StreamingResampler,
  resampleLinear,
} from '../../../apps/chrome-extension/src/audio/resampler.js';

describe('PCM conversion', () => {
  it('clamps float samples to the representable range', () => {
    expect(clampSample(2)).toBe(1);
    expect(clampSample(-2)).toBe(-1);
    expect(clampSample(0.25)).toBe(0.25);
  });

  it('converts floats to signed 16-bit little-endian values', () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768]);
  });

  it('applies gain before clamping', () => {
    const pcm = floatToPcm16(new Float32Array([0.5, -0.5]), 2);
    expect(Array.from(pcm)).toEqual([32767, -32768]);
  });

  it('round-trips within one quantisation step', () => {
    const input = new Float32Array([0, 0.1, -0.1, 0.5, -0.5, 0.999, -0.999]);
    const roundTripped = pcm16ToFloat(floatToPcm16(input));
    for (let index = 0; index < input.length; index += 1) {
      expect(Math.abs((roundTripped[index] ?? 0) - (input[index] ?? 0))).toBeLessThan(1 / 16_000);
    }
  });

  it('computes RMS for floats and int16', () => {
    expect(rms(new Float32Array([]))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
    expect(int16Rms(new Int16Array([]))).toBe(0);
    expect(int16Rms(new Int16Array([16_384, -16_384]))).toBeCloseTo(0.5, 4);
  });

  it('concatenates PCM chunks in order', () => {
    const joined = concatInt16([new Int16Array([1, 2]), new Int16Array([]), new Int16Array([3])]);
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });
});

describe('base64 audio helpers', () => {
  it('round-trips arbitrary bytes, including a buffer larger than one chunk', () => {
    const bytes = new Uint8Array(70_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;

    const encoded = bytesToBase64(bytes);
    const decoded = base64ToBytes(encoded);

    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(0);
    expect(decoded[65_535]).toBe(65_535 % 251);
  });

  it('round-trips int16 PCM through base64', () => {
    const samples = new Int16Array([0, 1, -1, 32_767, -32_768, 12_345]);
    const encoded = int16ToBase64(samples);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Array.from(base64ToInt16(encoded))).toEqual(Array.from(samples));
  });

  it('ignores a trailing odd byte rather than throwing', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0xff]);
    const decoded = base64ToInt16(bytesToBase64(bytes));
    expect(decoded.length).toBe(1);
    expect(decoded[0]).toBe(1);
  });

  it('converts model audio straight to floats', () => {
    const floats = base64PcmToFloat(int16ToBase64(new Int16Array([16_384, -16_384])));
    expect(floats[0]).toBeCloseTo(0.5, 4);
    expect(floats[1]).toBeCloseTo(-0.5, 4);
  });
});

describe('StreamingResampler', () => {
  it('passes audio through untouched when rates match', () => {
    const resampler = new StreamingResampler(16_000, 16_000);
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampler.passthrough).toBe(true);
    expect(resampler.process(input)).toBe(input);
  });

  it('rejects invalid sample rates', () => {
    expect(() => new StreamingResampler(0, 16_000)).toThrow();
    expect(() => new StreamingResampler(16_000, -1)).toThrow();
  });

  it('downsamples 48 kHz to 16 kHz at the correct rate', () => {
    const input = new Float32Array(4_800);
    for (let index = 0; index < input.length; index += 1) {
      input[index] = Math.sin((2 * Math.PI * 440 * index) / 48_000);
    }

    const output = resampleLinear(input, 48_000, 16_000);

    expect(output.length).toBeGreaterThanOrEqual(1_598);
    expect(output.length).toBeLessThanOrEqual(1_600);
    expect(rms(output)).toBeGreaterThan(0.1);
  });

  it('upsamples 16 kHz to 24 kHz at the correct rate', () => {
    const input = new Float32Array(1_600).fill(0.25);
    const output = resampleLinear(input, 16_000, 24_000);
    expect(output.length).toBeGreaterThanOrEqual(2_398);
    expect(output.length).toBeLessThanOrEqual(2_400);
    expect(output[100]).toBeCloseTo(0.25, 6);
  });

  it('produces the same result whether audio arrives in one block or many', () => {
    const input = new Float32Array(960);
    for (let index = 0; index < input.length; index += 1) {
      input[index] = Math.sin(index / 7);
    }

    const oneShot = resampleLinear(input, 48_000, 16_000);
    const streaming = new StreamingResampler(48_000, 16_000);
    const parts: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 160) {
      parts.push(streaming.process(input.subarray(offset, offset + 160)));
    }
    const streamed = concatFloat(parts);

    expect(streamed.length).toBe(oneShot.length);
    for (let index = 0; index < oneShot.length; index += 1) {
      expect(streamed[index]).toBeCloseTo(oneShot[index] ?? 0, 6);
    }
  });

  it('returns an empty block for empty input and resets cleanly', () => {
    const resampler = new StreamingResampler(48_000, 16_000);
    expect(resampler.process(new Float32Array(0)).length).toBe(0);
    resampler.process(new Float32Array([1, 2, 3, 4]));
    resampler.reset();
    const output = resampler.process(new Float32Array(4).fill(0.5));
    expect(output.length).toBe(1);
    expect(output[0]).toBeCloseTo(0.5, 6);
  });
});

function concatFloat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
