import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './runtime-paths.js';

const RENDERER_LOG = join(LOGS_DIR, 'renderer.log');
const MAX_BYTES = 5 * 1024 * 1024;
let approxSize = -1; // tracked in memory: no statSync per console message

export function appendRendererLog(line: string): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    if (approxSize < 0) {
      try {
        approxSize = statSync(RENDERER_LOG).size;
      } catch {
        approxSize = 0;
      }
    }
    if (approxSize >= MAX_BYTES) {
      try {
        unlinkSync(`${RENDERER_LOG}.1`);
      } catch {}
      try {
        renameSync(RENDERER_LOG, `${RENDERER_LOG}.1`);
      } catch {}
      approxSize = 0;
    }
    const text = `[${new Date().toISOString()}] ${line}\n`;
    appendFileSync(RENDERER_LOG, text, 'utf8');
    approxSize += Buffer.byteLength(text);
  } catch {
    /* logging must never crash the HUD */
  }
}