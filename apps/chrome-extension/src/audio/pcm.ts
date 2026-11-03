/**
 * PCM helpers for the Gemini Live audio contract.
 *
 * Wire format: signed 16-bit little-endian, mono.
 * Input 16 kHz, output 24 kHz. No containers, no codecs.
 */

export function clampSample(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

/** Float32 [-1, 1] → Int16 PCM with optional gain and soft clipping. */
export function floatToPcm16(samples: Float32Array, gain = 1): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = clampSample((samples[i] ?? 0) * gain);
    // 32767 keeps the positive and negative ranges symmetric enough for speech.
    out[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return out;
}

export function pcm16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = (samples[i] ?? 0) / 32768;
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function concatInt16(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Chunked base64 so a long buffer cannot overflow the argument stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function int16ToBase64(samples: Int16Array): string {
  return bytesToBase64(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
}

export function base64ToInt16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  // Copy into a fresh buffer so the Int16Array is correctly aligned.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2));
}

/** Convert 24 kHz PCM from the model into float samples for playback. */
export function base64PcmToFloat(base64: string): Float32Array {
  return pcm16ToFloat(base64ToInt16(base64));
}

export function int16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = (samples[i] ?? 0) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}
