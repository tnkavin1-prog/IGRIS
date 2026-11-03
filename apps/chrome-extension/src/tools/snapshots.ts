/**
 * Short-lived evidence stores for visual clicks and state comparison.
 *
 * A screenshot token is deliberately short-lived and bound to a URL and scroll
 * position. Coordinate clicks are rejected when the page has moved since the
 * image the user approved.
 */
import { bytesToBase64 } from '../audio/pcm.js';

export interface ScreenshotRecord {
  id: string;
  tabId: number;
  url: string;
  title: string;
  scrollY: number;
  digest: string;
  capturedAt: number;
  /** CSS-pixel viewport at capture time. */
  viewportWidth: number;
  viewportHeight: number;
  /** Encoded JPEG dimensions. */
  imageWidth: number;
  imageHeight: number;
  jpegBase64: string;
  jpegDataUrl: string;
}

export class ScreenshotStore {
  private readonly records = new Map<string, ScreenshotRecord>();

  add(record: Omit<ScreenshotRecord, 'id' | 'capturedAt'>): ScreenshotRecord {
    const id = `shot_${crypto.randomUUID()}`;
    const stored: ScreenshotRecord = { ...record, id, capturedAt: Date.now() };
    this.records.set(id, stored);
    while (this.records.size > 8) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    return stored;
  }

  get(id: string): ScreenshotRecord | undefined {
    return this.records.get(id);
  }

  prune(maxAgeMs = 10 * 60_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, record] of this.records) {
      if (record.capturedAt < cutoff) this.records.delete(id);
    }
  }
}

export interface StateRecord {
  token: string;
  url: string;
  title: string;
  digest: string;
  scrollY: number;
  scrollMax: number;
  elementCount: number;
  textLength: number;
  at: number;
}

export class StateStore {
  private readonly records = new Map<string, StateRecord>();

  add(state: Omit<StateRecord, 'token' | 'at'>): StateRecord {
    const token = `state_${crypto.randomUUID()}`;
    const record: StateRecord = { ...state, token, at: Date.now() };
    this.records.set(token, record);
    while (this.records.size > 20) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    return record;
  }

  get(token: string): StateRecord | undefined {
    return this.records.get(token);
  }
}

export async function encodeScreenshot(
  pngDataUrl: string,
  maxWidth = 1_280,
): Promise<{
  jpegBase64: string;
  jpegDataUrl: string;
  width: number;
  height: number;
}> {
  const response = await fetch(pngDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a 2D canvas for the screenshot.');
    context.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const base64 = bytesToBase64(bytes);
    return {
      jpegBase64: base64,
      jpegDataUrl: `data:image/jpeg;base64,${base64}`,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
