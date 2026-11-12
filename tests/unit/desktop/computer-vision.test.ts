import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as ocr from '../../../apps/desktop-hud/src/main/windows-ocr.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';

describe('ComputerVisionService', () => {
  let vision: ComputerVisionService;

  beforeEach(() => {
    vision = new ComputerVisionService({ mockMode: true });
  });

  it('lists desktop capture sources including primary screen and windows', async () => {
    const sources = await vision.listSources();
    expect(sources.length).toBeGreaterThan(0);
    const screenSource = sources.find((s) => s.isScreen);
    expect(screenSource).toBeDefined();
    expect(screenSource?.name).toContain('Primary Display');
  });

  it('captures full screen desktop image and returns base64 JPEG', async () => {
    const shot = await vision.captureScreen();
    expect(shot.mimeType).toBe('image/jpeg');
    expect(typeof shot.data).toBe('string');
    expect(shot.data.length).toBeGreaterThan(20);
    expect(shot.width).toBe(1920);
    expect(shot.height).toBe(1080);
    expect(shot.timestamp).toBeGreaterThan(0);
  });

  it('captures a specific window by title query', async () => {
    const shot = await vision.captureWindow('Chrome');
    expect(shot.mimeType).toBe('image/jpeg');
    expect(shot.sourceName).toContain('Chrome');
    expect(shot.width).toBe(1280);
    expect(shot.height).toBe(720);
  });

  it('retrieves display metrics with resolution, scale factor, and bounds', () => {
    const metrics = vision.getDisplayMetrics();
    expect(metrics.width).toBe(1920);
    expect(metrics.height).toBe(1080);
    expect(metrics.scaleFactor).toBe(1.0);
    expect(metrics.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(metrics.allDisplays).toBeDefined();
    expect(metrics.allDisplays?.length).toBeGreaterThan(0);
    expect(metrics.virtualBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('maps OCR word and phrase boxes to physical display pixels', async () => {
    vision.setMockMode(false);
    const capture = vi.spyOn(vision, 'captureScreen').mockResolvedValue({
      data: '',
      mimeType: 'image/jpeg',
      width: 1000,
      height: 500,
      timestamp: 0,
      screenBounds: { x: -2000, y: 100, width: 2000, height: 1000 },
    });
    const recognize = vi.spyOn(ocr, 'recognizeScreenshot').mockResolvedValue({
      text: 'Save file',
      lines: [
        {
          text: 'Save file',
          words: [
            { text: 'Save', bounds: { x: 100, y: 50, width: 40, height: 20 } },
            { text: 'file', bounds: { x: 150, y: 50, width: 30, height: 20 } },
          ],
        },
      ],
    });
    try {
      const result = await vision.readScreenOcr();
      expect(result.matches[0]).toMatchObject({ x: -1760, y: 220, source: 'ocr' });
      expect(result.matches[2]).toMatchObject({
        text: 'Save file',
        bounds: { x: -1800, y: 200, width: 160, height: 40 },
      });
    } finally {
      capture.mockRestore();
      recognize.mockRestore();
    }
  });

  it('supports toggling mock mode', () => {
    vision.setMockMode(false);
    vision.setMockMode(true);
    expect(vision.getDisplayMetrics().width).toBe(1920);
  });
});
