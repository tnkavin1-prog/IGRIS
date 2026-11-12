import { describe, it, expect, beforeEach } from 'vitest';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('Desktop Radar - Active Applications & Window Management', () => {
  let appManager: AppManagerService;

  beforeEach(() => {
    appManager = new AppManagerService({ mockMode: true });
  });

  it('lists active running desktop windows with titles and process names', async () => {
    const wins = await appManager.listRunningWindows();
    expect(wins.length).toBeGreaterThan(0);

    const chrome = wins.find((w) => w.processName.toLowerCase().includes('chrome'));
    expect(chrome).toBeDefined();
    expect(chrome?.title).toBe('Google Chrome');
    expect(chrome?.isVisible).toBe(true);

    const vscode = wins.find((w) => w.processName.toLowerCase().includes('code'));
    expect(vscode).toBeDefined();
    expect(vscode?.title).toBe('Visual Studio Code');
  });

  it('focuses an application window by title query', async () => {
    const ok = await appManager.focusWindow('Chrome');
    expect(ok).toBe(true);

    const nonExistent = await appManager.focusWindow('NON_EXISTENT_WINDOW_999');
    expect(nonExistent).toBe(false);
  });

  it('focuses an application window by numeric HWND', async () => {
    const wins = await appManager.listRunningWindows();
    const targetHwnd = wins[0]?.hwnd;
    expect(targetHwnd).toBeDefined();
    if (targetHwnd === undefined) throw new Error('no window to focus');

    const ok = await appManager.focusWindow(targetHwnd);
    expect(ok).toBe(true);
  });

  it('minimizes an active application window', async () => {
    const ok = await appManager.minimizeWindow('Visual Studio Code');
    expect(ok).toBe(true);

    const wins = await appManager.listRunningWindows();
    const codeWin = wins.find((w) => w.title.includes('Visual Studio Code'));
    expect(codeWin?.isIconic).toBe(true);
  });

  it('maximizes or restores a minimized application window', async () => {
    await appManager.minimizeWindow('Visual Studio Code');
    const ok = await appManager.maximizeWindow('Visual Studio Code');
    expect(ok).toBe(true);

    const wins = await appManager.listRunningWindows();
    const codeWin = wins.find((w) => w.title.includes('Visual Studio Code'));
    expect(codeWin?.isIconic).toBe(false);
  });

  it('retrieves accurate window bounds', async () => {
    const bounds = await appManager.getWindowBounds('Chrome');
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('searches text across windows with containerTitle metadata in AppManagerService', async () => {
    const matches = await appManager.findText('Chrome');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.text).toContain('Google Chrome');
    expect(matches[0]?.containerTitle).toBe('Google Chrome');
  });

  it('filters text search by windowScope in AppManagerService', async () => {
    // Search for "Code" within "Chrome" window scope should yield empty
    const noMatch = await appManager.findText('Code', 'Google Chrome');
    expect(noMatch.length).toBe(0);

    // Search for "Code" within "Visual Studio" scope should match
    const match = await appManager.findText('Code', 'Visual Studio');
    expect(match.length).toBeGreaterThan(0);
    expect(match[0]?.text).toBe('Visual Studio Code');
    expect(match[0]?.containerTitle).toBe('Visual Studio Code');
  });
});
