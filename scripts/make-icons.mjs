#!/usr/bin/env node
/**
 * Dependency-free icon generator.
 *
 * Chrome requires PNGs, and the repository intentionally ships no binary
 * assets. This draws the brand mark (three waveform bars on a violet→cyan
 * rounded square) with 4× supersampling and encodes a real RGBA PNG using
 * only node:zlib.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Sample one subpixel. Returns [r, g, b, a] with straight alpha. */
function sample(x, y, size) {
  const pad = size * 0.015;
  const radius = size * 0.235;
  if (!insideRoundRect(x, y, pad, pad, size - pad * 2, size - pad * 2, radius)) {
    return [0, 0, 0, 0];
  }

  const t = (x / size) * 0.55 + (y / size) * 0.45;
  let r = lerp(124, 34, t);
  let g = lerp(58, 211, t);
  let b = lerp(237, 238, t);

  // A soft highlight in the upper-left gives the tile depth at 128 px.
  const hx = x / size - 0.28;
  const hy = y / size - 0.22;
  const highlight = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) * 2.6) * 0.28;
  r = lerp(r, 255, highlight);
  g = lerp(g, 255, highlight);
  b = lerp(b, 255, highlight);

  // Three centered bars with the middle one tallest.
  const barWidth = size * 0.105;
  const gap = size * 0.062;
  const heights = [0.3, 0.54, 0.4].map((value) => value * size);
  const totalWidth = barWidth * 3 + gap * 2;
  const startX = (size - totalWidth) / 2;
  const barRadius = barWidth / 2;
  for (let index = 0; index < 3; index += 1) {
    const barX = startX + index * (barWidth + gap);
    const barY = (size - heights[index]) / 2;
    if (insideRoundRect(x, y, barX, barY, barWidth, heights[index], barRadius)) {
      return [11, 7, 22, 255];
    }
  }

  return [r, g, b, 255];
}

function render(size) {
  const ss = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const [sr, sg, sb, sa] = sample(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss, size);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += sa;
        }
      }
      const samples = ss * ss;
      const alpha = a / samples;
      const weight = a / 255 || 1;
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r / weight);
      rgba[offset + 1] = Math.round(g / weight);
      rgba[offset + 2] = Math.round(b / weight);
      rgba[offset + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

export function generateIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    writeFileSync(join(outDir, `icon${size}.png`), render(size));
  }
}

export function generateIco(outFilePath, sizes = [16, 32, 48, 128, 256]) {
  mkdirSync(dirname(outFilePath), { recursive: true });
  const images = sizes.map((s) => ({ size: s, data: render(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type (1 = ICO)
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // image size in bytes
    entry.writeUInt32LE(offset, 12); // image offset in file
    entries.push(entry);
    offset += img.data.length;
  }

  const icoBuffer = Buffer.concat([header, ...entries, ...images.map((img) => img.data)]);
  writeFileSync(outFilePath, icoBuffer);
  return icoBuffer;
}

const outDir = resolve(process.argv[2] ?? 'release/chrome-extension/icons');
generateIcons(outDir);
console.log(`Wrote icons to ${outDir}`);

const jarvisIcoPath = resolve('assets/icons/jarvis.ico');
generateIco(jarvisIcoPath);
console.log(`Wrote high-res icon to ${jarvisIcoPath}`);
