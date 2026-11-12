import { Tray, Menu, app, shell, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ICON_PATH, NOTES_DIR } from './runtime-paths.js';

export interface TrayManagerCallbacks {
  onSummon?: () => void;
  onKillswitch?: () => void;
  onDesktopRadar?: () => void;
  onVisualBlackboard?: () => void;
  onToggleSoundMute?: () => void;
  onOpenNotes?: () => void;
  onExit?: () => void;
  getStatus?: () => string;
  isSoundMuted?: () => boolean;
}

export interface TrayManagerOptions {
  iconPath?: string;
  callbacks?: TrayManagerCallbacks;
  mockMode?: boolean;
  notesDir?: string;
}

export interface TrayMenuItemSpec {
  label?: string;
  type?: 'separator' | 'normal';
  enabled?: boolean;
  click?: () => void;
}

/**
 * Windows System Tray & Background Daemon Manager for JARVIS AI Assistant
 */
export class TrayManager {
  private tray: Tray | null = null;
  private callbacks: TrayManagerCallbacks;
  private iconPath: string;
  private mockMode: boolean;
  private currentStatus = 'Idle';
  private isMuted = false;
  private notesDir: string;
  private lastMenuItems: TrayMenuItemSpec[] = [];

  constructor(options: TrayManagerOptions = {}) {
    this.callbacks = options.callbacks || {};
    this.iconPath = options.iconPath || resolve(ICON_PATH);
    this.mockMode =
      options.mockMode ??
      (typeof Tray === 'undefined' ||
        typeof Menu === 'undefined' ||
        typeof Menu.buildFromTemplate !== 'function');
    this.notesDir = options.notesDir || NOTES_DIR;
  }

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  public get isMockMode(): boolean {
    return this.mockMode;
  }

  public get status(): string {
    return this.currentStatus;
  }

  public get muted(): boolean {
    return this.isMuted;
  }

  public get menuItems(): TrayMenuItemSpec[] {
    return [...this.lastMenuItems];
  }

  /**
   * Initializes the system tray icon and context menu
   */
  public init(): boolean {
    this.updateContextMenu();

    if (this.mockMode) {
      return true;
    }

    try {
      let icon: Electron.NativeImage;
      if (existsSync(this.iconPath)) {
        icon = nativeImage.createFromPath(this.iconPath);
      } else {
        icon = nativeImage.createEmpty();
      }

      this.tray = new Tray(icon);
      this.tray.setToolTip(`JARVIS AI Assistant - [${this.getStatusLabel()}]`);

      this.applyNativeMenu();

      this.tray.on('click', () => {
        this.handleSummon();
      });

      this.tray.on('double-click', () => {
        this.handleSummon();
      });

      return true;
    } catch (err) {
      console.warn('[TrayManager] Failed to initialize system tray:', err);
      return false;
    }
  }

  /**
   * Updates dynamic status (Idle / Running Task / Paused / Listening)
   */
  public setStatus(status: string): void {
    this.currentStatus = status;
    this.updateContextMenu();
    if (!this.mockMode && this.tray) {
      try {
        this.tray.setToolTip(`JARVIS AI Assistant - [${this.getStatusLabel()}]`);
        this.applyNativeMenu();
      } catch {}
    }
  }

  /**
   * Sets mute state for the tray label
   */
  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.updateContextMenu();
    if (!this.mockMode && this.tray) {
      try {
        this.applyNativeMenu();
      } catch {}
    }
  }

  public handleSummon(): void {
    this.callbacks.onSummon?.();
  }

  public handleKillswitch(): void {
    this.callbacks.onKillswitch?.();
  }

  public handleDesktopRadar(): void {
    this.callbacks.onDesktopRadar?.();
  }

  public handleVisualBlackboard(): void {
    this.callbacks.onVisualBlackboard?.();
  }

  public handleToggleMute(): void {
    this.isMuted = !this.isMuted;
    this.callbacks.onToggleSoundMute?.();
    this.updateContextMenu();
  }

  public handleOpenNotes(): void {
    if (this.callbacks.onOpenNotes) {
      this.callbacks.onOpenNotes();
    } else {
      try {
        void shell.openPath(this.notesDir);
      } catch {}
    }
  }

  public handleExit(): void {
    if (this.callbacks.onExit) {
      this.callbacks.onExit();
    } else {
      try {
        app.quit();
      } catch {}
    }
  }

  public getStatusLabel(): string {
    if (this.callbacks.getStatus) {
      return this.callbacks.getStatus();
    }
    return this.currentStatus;
  }

  /**
   * Rebuilds context menu items
   */
  public updateContextMenu(): TrayMenuItemSpec[] {
    const statusLabel = this.getStatusLabel();
    const muted = this.callbacks.isSoundMuted ? this.callbacks.isSoundMuted() : this.isMuted;

    this.lastMenuItems = [
      {
        label: '⚡ Summon JARVIS HUD (Ctrl+Alt+Space / Ctrl+Alt+J)',
        click: () => this.handleSummon(),
      },
      {
        label: `Status: [${statusLabel}]`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '🛑 Emergency Killswitch (Ctrl+Alt+K)',
        click: () => this.handleKillswitch(),
      },
      {
        label: '📡 Desktop Radar',
        click: () => this.handleDesktopRadar(),
      },
      {
        label: '📐 Visual Blackboard',
        click: () => this.handleVisualBlackboard(),
      },
      {
        label: muted ? '🔈 Unmute Sound' : '🔊 Toggle Sound Mute',
        click: () => this.handleToggleMute(),
      },
      {
        label: '📝 Open Session Notes',
        click: () => this.handleOpenNotes(),
      },
      { type: 'separator' },
      {
        label: '❌ Exit',
        click: () => this.handleExit(),
      },
    ];

    return this.lastMenuItems;
  }

  private applyNativeMenu(): void {
    if (this.mockMode || !this.tray || typeof Menu === 'undefined') return;

    try {
      const template = this.lastMenuItems.map((item) => {
        if (item.type === 'separator') {
          return { type: 'separator' as const };
        }
        return {
          label: item.label,
          enabled: item.enabled ?? true,
          click: item.click,
        };
      });

      const menu = Menu.buildFromTemplate(template);
      this.tray.setContextMenu(menu);
    } catch (err) {
      console.warn('[TrayManager] Failed to apply context menu:', err);
    }
  }

  public destroy(): void {
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch {}
      this.tray = null;
    }
  }
}
