import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SCRIPTS_DIR, TEMP_DIR } from './runtime-paths.js';
import type { CaptureResult } from './types.js';

export interface OcrWord {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OcrResult {
  text: string;
  lines: Array<{ text: string; words: OcrWord[] }>;
}

const runFile = promisify(execFile);

export async function recognizeScreenshot(shot: CaptureResult): Promise<OcrResult> {
  if (process.platform !== 'win32') throw new Error('Windows OCR is only available on Windows.');
  const dir = await mkdtemp(join(TEMP_DIR, 'ocr-'));
  try {
    const imagePath = join(dir, shot.mimeType === 'image/png' ? 'screen.png' : 'screen.jpg');
    await writeFile(imagePath, Buffer.from(shot.data, 'base64'));
    const { stdout } = await runFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(SCRIPTS_DIR, 'ocr-screen.ps1'),
        '-ImagePath',
        imagePath,
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
    );
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as OcrResult;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
