import { describe, it, expect } from 'vitest';
import { VideoReader } from '../../../apps/desktop-hud/src/main/video-reader.js';

describe('VideoReader', () => {
  it('probes and extracts key frames from a real video', async () => {
    const src =
      'C:/ChromeAgentProfile/Default/Extensions/efaidnbmnnnibpcajpcglclefindmkaj/26.9.1.0_1/browser/images/LocalizedSummaryFte/de/summary.mp4';
    const result = await new VideoReader().analyze(src, { maxFrames: 4, extractAudio: false });
    console.log('video ->', JSON.stringify(result).slice(0, 600));
    expect(result.ok).toBe(true);
    expect(result.metadata?.width).toBe(840);
    expect(result.metadata?.height).toBe(480);
    expect(result.metadata?.hasAudio).toBe(false); // this clip has no audio
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.frames[0]?.data).toBeTruthy();
  });

  it('reports a missing file instead of throwing', async () => {
    const result = await new VideoReader().analyze('E:\\definitely\\missing\\clip.mp4');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not read');
  });

  it('reports a non-video file instead of throwing', async () => {
    const fs = await import('node:fs');
    fs.mkdirSync('E:\\Gemetron\\temp\\video-bad', { recursive: true });
    fs.writeFileSync('E:\\Gemetron\\temp\\video-bad\\not-a-video.txt', 'hello');
    const result = await new VideoReader().analyze(
      'E:\\Gemetron\\temp\\video-bad\\not-a-video.txt',
    );
    expect(result.ok).toBe(false);
    try {
      fs.rmSync('E:\\Gemetron\\temp\\video-bad', { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
});
