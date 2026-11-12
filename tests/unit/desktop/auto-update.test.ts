import { beforeEach, describe, expect, it, vi } from 'vitest';
const { app, dialog, updater, handlers } = vi.hoisted(() => {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    app: { isPackaged: true },
    dialog: { showMessageBox: vi.fn() },
    handlers,
    updater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn((name: string, fn: any) => {
        handlers[name] = fn;
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
});
vi.mock('electron', () => ({ app, dialog }));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));
import { startAutoUpdates } from '../../../apps/desktop-hud/src/main/auto-update.js';
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GEMATRON_CHECK_UPDATES;
  app.isPackaged = true;
  updater.checkForUpdates.mockResolvedValue(null);
  updater.downloadUpdate.mockResolvedValue([]);
});
describe('opt-in updates', () => {
  it('never checks by default or in development', () => {
    startAutoUpdates()();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    process.env.GEMATRON_CHECK_UPDATES = 'true';
    app.isPackaged = false;
    startAutoUpdates()();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it('requires confirmation for both download and restart', async () => {
    process.env.GEMATRON_CHECK_UPDATES = 'true';
    const stop = startAutoUpdates();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    await handlers['update-available']!({ version: '2.0.0' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    await handlers['update-available']!({ version: '2.0.0' });
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    await handlers['update-downloaded']!();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    stop();
    delete process.env.GEMATRON_CHECK_UPDATES;
  });
});
