import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { TrayManager } from '../../../apps/desktop-hud/src/main/tray-manager.js';
import type { TrayManagerCallbacks } from '../../../apps/desktop-hud/src/main/tray-manager.js';

describe('TrayManager - Windows System Tray & Background Daemon', () => {
  let callbacks: TrayManagerCallbacks & {
    onSummon: Mock<() => void>;
    onKillswitch: Mock<() => void>;
    onDesktopRadar: Mock<() => void>;
    onVisualBlackboard: Mock<() => void>;
    onToggleSoundMute: Mock<() => void>;
    onOpenNotes: Mock<() => void>;
    onExit: Mock<() => void>;
    getStatus: Mock<() => string>;
  };
  let trayManager: TrayManager;

  beforeEach(() => {
    callbacks = {
      onSummon: vi.fn<() => void>(),
      onKillswitch: vi.fn<() => void>(),
      onDesktopRadar: vi.fn<() => void>(),
      onVisualBlackboard: vi.fn<() => void>(),
      onToggleSoundMute: vi.fn<() => void>(),
      onOpenNotes: vi.fn<() => void>(),
      onExit: vi.fn<() => void>(),
      getStatus: vi.fn<() => string>().mockReturnValue('Idle'),
    };

    trayManager = new TrayManager({
      mockMode: true,
      callbacks,
    });
  });

  it('initializes successfully in mockMode', () => {
    expect(trayManager.isMockMode).toBe(true);
    const initialized = trayManager.init();
    expect(initialized).toBe(true);
  });

  it('generates all expected tray context menu items with exact requirements', () => {
    trayManager.init();
    const items = trayManager.menuItems;

    expect(items.length).toBeGreaterThanOrEqual(8);

    const labels = items.map((i) => i.label).filter(Boolean);

    // 1. Summon HUD
    expect(
      labels.some((l) => l?.includes('Summon Gematron HUD') && l.includes('Ctrl+Alt+Space')),
    ).toBe(true);

    // 2. Dynamic status
    expect(labels.some((l) => l?.includes('Status:') && l.includes('Idle'))).toBe(true);

    // 3. Emergency Killswitch
    expect(
      labels.some((l) => l?.includes('Emergency Killswitch') && l.includes('Ctrl+Alt+K')),
    ).toBe(true);

    // 4. Desktop Radar
    expect(labels.some((l) => l?.includes('Desktop Radar'))).toBe(true);

    // 5. Visual Blackboard
    expect(labels.some((l) => l?.includes('Visual Blackboard'))).toBe(true);

    // 6. Sound Mute
    expect(labels.some((l) => l?.includes('Toggle Sound Mute'))).toBe(true);

    // 7. Session Notes
    expect(labels.some((l) => l?.includes('Open Session Notes'))).toBe(true);

    // 8. Exit
    expect(labels.some((l) => l?.includes('Exit'))).toBe(true);
  });

  it('triggers registered callbacks when menu items are clicked', () => {
    trayManager.init();
    const items = trayManager.menuItems;

    // Click Summon
    const summonItem = items.find((i) => i.label?.includes('Summon Gematron HUD'));
    summonItem?.click?.();
    expect(callbacks.onSummon).toHaveBeenCalledTimes(1);

    // Click Killswitch
    const killItem = items.find((i) => i.label?.includes('Emergency Killswitch'));
    killItem?.click?.();
    expect(callbacks.onKillswitch).toHaveBeenCalledTimes(1);

    // Click Desktop Radar
    const radarItem = items.find((i) => i.label?.includes('Desktop Radar'));
    radarItem?.click?.();
    expect(callbacks.onDesktopRadar).toHaveBeenCalledTimes(1);

    // Click Visual Blackboard
    const boardItem = items.find((i) => i.label?.includes('Visual Blackboard'));
    boardItem?.click?.();
    expect(callbacks.onVisualBlackboard).toHaveBeenCalledTimes(1);

    // Click Toggle Sound Mute
    const muteItem = items.find((i) => i.label?.includes('Toggle Sound Mute'));
    muteItem?.click?.();
    expect(callbacks.onToggleSoundMute).toHaveBeenCalledTimes(1);

    // Click Open Session Notes
    const notesItem = items.find((i) => i.label?.includes('Open Session Notes'));
    notesItem?.click?.();
    expect(callbacks.onOpenNotes).toHaveBeenCalledTimes(1);

    // Click Exit
    const exitItem = items.find((i) => i.label?.includes('Exit'));
    exitItem?.click?.();
    expect(callbacks.onExit).toHaveBeenCalledTimes(1);
  });

  it('dynamically reflects running task and paused statuses', () => {
    trayManager.init();

    // Change status via setStatus
    callbacks.getStatus.mockReturnValue('Running Task');
    trayManager.setStatus('Running Task');

    let statusItem = trayManager.menuItems.find((i) => i.label?.startsWith('Status:'));
    expect(statusItem?.label).toBe('Status: [Running Task]');

    // Paused status
    callbacks.getStatus.mockReturnValue('Paused');
    trayManager.setStatus('Paused');

    statusItem = trayManager.menuItems.find((i) => i.label?.startsWith('Status:'));
    expect(statusItem?.label).toBe('Status: [Paused]');
  });

  it('updates mute toggle label when muted state changes', () => {
    trayManager.init();

    expect(trayManager.muted).toBe(false);
    let muteItem = trayManager.menuItems.find((i) => i.label?.includes('Sound Mute'));
    expect(muteItem?.label).toContain('Toggle Sound Mute');

    // Trigger mute
    trayManager.handleToggleMute();
    expect(trayManager.muted).toBe(true);
    expect(callbacks.onToggleSoundMute).toHaveBeenCalled();

    muteItem = trayManager.menuItems.find((i) => i.label?.includes('Sound'));
    expect(muteItem?.label).toContain('Unmute Sound');
  });

  it('destroys cleanly without errors', () => {
    trayManager.init();
    expect(() => trayManager.destroy()).not.toThrow();
  });
});
