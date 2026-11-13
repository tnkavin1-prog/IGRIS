import { describe, it, expect } from 'vitest';
import { transcribeAudio } from '../../../apps/desktop-hud/src/main/audio-transcriber.js';

describe('audio transcriber', () => {
  it('reports a missing API key', async () => {
    const result = await transcribeAudio('C:\\nope.wav', { apiKey: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('API key');
  });

  it('reports a missing file', async () => {
    const result = await transcribeAudio('E:\\definitely-missing.wav', { apiKey: 'fake-key' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not read');
  });
});
