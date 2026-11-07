import { describe, it, expect, vi } from 'vitest';
import { ChromeLauncher } from '../../../apps/desktop-hud/src/main/chrome-launcher.js';

describe('ChromeLauncher', () => {
  it('detects if Chrome remote debugging port is already responsive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as Response);

    const available = await ChromeLauncher.isPortAvailable(9222);
    expect(available).toBe(true);
  });

  it('detects if Chrome remote debugging port is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

    const available = await ChromeLauncher.isPortAvailable(9222);
    expect(available).toBe(false);
  });

  it('returns immediately with success if port is already active', async () => {
    vi.spyOn(ChromeLauncher, 'isPortAvailable').mockResolvedValue(true);

    const res = await ChromeLauncher.launch();
    expect(res.ok).toBe(true);
    expect(res.message).toContain('already active');
  });
});
