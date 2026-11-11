import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { CursorPosition, DisplayMetrics, SingleDisplayInfo } from './types.js';

export interface NativeInputOptions {
  mockMode?: boolean;
  scriptsDir?: string;
  displayMetrics?: DisplayMetrics;
}

export interface InputCoordinateOptions {
  scaleWithDpi?: boolean;
  monitorId?: number;
}

export interface InputActionEvent {
  type: 'move' | 'click' | 'drag' | 'scroll' | 'type' | 'hotkey' | 'release-all';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
  text?: string;
  keys?: string;
  skipHighlight?: boolean;
  timestamp: number;
}

export class NativeInputService extends EventEmitter {
  private mockMode: boolean;
  private scriptsDir: string;
  private simulatedCursor: CursorPosition = { x: 0, y: 0 };
  private actionHistory: InputActionEvent[] = [];
  private displayMetrics?: DisplayMetrics;

  constructor(options: NativeInputOptions = {}) {
    super();
    this.mockMode = options.mockMode ?? process.platform !== 'win32';
    this.scriptsDir = options.scriptsDir || 'E:\\Gematron\\scripts';
    this.displayMetrics = options.displayMetrics;
  }

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  public isMockMode(): boolean {
    return this.mockMode;
  }

  public setDisplayMetrics(metrics: DisplayMetrics): void {
    this.displayMetrics = metrics;
  }

  public getDisplayMetrics(): DisplayMetrics | undefined {
    return this.displayMetrics;
  }

  /**
   * Map logical coordinates to physical monitor pixels across mixed-DPI multi-monitor arrangements
   */
  public mapCoordinates(
    x: number,
    y: number,
    options: InputCoordinateOptions = {},
  ): { x: number; y: number } {
    if (
      !options.scaleWithDpi ||
      !this.displayMetrics?.allDisplays ||
      this.displayMetrics.allDisplays.length === 0
    ) {
      return { x: Math.round(x), y: Math.round(y) };
    }

    let target: SingleDisplayInfo | undefined =
      options.monitorId !== undefined
        ? this.displayMetrics.allDisplays.find((d) => d.id === options.monitorId)
        : undefined;

    if (!target) {
      target =
        this.displayMetrics.allDisplays.find(
          (d) =>
            x >= d.bounds.x &&
            x < d.bounds.x + d.bounds.width &&
            y >= d.bounds.y &&
            y < d.bounds.y + d.bounds.height,
        ) ||
        this.displayMetrics.allDisplays.find((d) => d.isPrimary) ||
        this.displayMetrics.allDisplays[0];
    }

    if (!target || target.scaleFactor === 1.0) {
      return { x: Math.round(x), y: Math.round(y) };
    }

    const originX = target.physicalBounds?.x ?? target.bounds.x;
    const originY = target.physicalBounds?.y ?? target.bounds.y;
    const relX = x - target.bounds.x;
    const relY = y - target.bounds.y;
    const physX = originX + Math.round(relX * target.scaleFactor);
    const physY = originY + Math.round(relY * target.scaleFactor);

    return { x: physX, y: physY };
  }

  public toPhysical(x: number, y: number, monitorId?: number): { x: number; y: number } {
    return this.mapCoordinates(x, y, { scaleWithDpi: true, monitorId });
  }

  public toLogical(x: number, y: number): { x: number; y: number } {
    if (!this.displayMetrics?.allDisplays || this.displayMetrics.allDisplays.length === 0) {
      return { x: Math.round(x), y: Math.round(y) };
    }

    const target =
      this.displayMetrics.allDisplays.find((d) => {
        // Prevent sign/quadrant crossing (e.g. positive pixel falsely matching negative monitor)
        if (d.bounds.x < 0 && x >= 0) return false;
        if (d.bounds.x >= 0 && x < 0) return false;
        if (d.bounds.y < 0 && y >= 0) return false;
        if (d.bounds.y >= 0 && y < 0) return false;

        const pX = d.physicalBounds?.x ?? d.bounds.x;
        const pY = d.physicalBounds?.y ?? d.bounds.y;
        const pW = d.physicalBounds?.width ?? Math.round(d.bounds.width * d.scaleFactor);
        const pH = d.physicalBounds?.height ?? Math.round(d.bounds.height * d.scaleFactor);
        return x >= pX && x < pX + pW && y >= pY && y < pY + pH;
      }) ||
      this.displayMetrics.allDisplays.find((d) => d.isPrimary) ||
      this.displayMetrics.allDisplays[0];

    if (!target || target.scaleFactor === 1.0) {
      return { x: Math.round(x), y: Math.round(y) };
    }

    const originX = target.physicalBounds?.x ?? target.bounds.x;
    const originY = target.physicalBounds?.y ?? target.bounds.y;
    const relX = x - originX;
    const relY = y - originY;
    return {
      x: target.bounds.x + Math.round(relX / target.scaleFactor),
      y: target.bounds.y + Math.round(relY / target.scaleFactor),
    };
  }

  public getHistory(): InputActionEvent[] {
    return [...this.actionHistory];
  }

  public clearHistory(): void {
    this.actionHistory = [];
  }

  public getLastAction(): InputActionEvent | undefined {
    return this.actionHistory[this.actionHistory.length - 1];
  }

  /**
   * Release all held mouse buttons and modifier keys (Emergency Killswitch Safety)
   */
  public async releaseAllInputStates(): Promise<boolean> {
    const action: InputActionEvent = { type: 'release-all', timestamp: Date.now() };
    this.actionHistory.push(action);
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const res = await this.runCli('release-all');
      return res.toLowerCase().includes('true');
    } catch {
      return this.invokeWin32('[Gemetron.Win32Input]::ReleaseAllInputs()');
    }
  }

  /**
   * Move mouse cursor to (x, y) coordinates with optional DPI scaling
   */
  public async mouseMove(
    x: number,
    y: number,
    options: InputCoordinateOptions = {},
  ): Promise<boolean> {
    const coords = this.mapCoordinates(x, y, options);
    const action: InputActionEvent = {
      type: 'move',
      x: coords.x,
      y: coords.y,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.simulatedCursor = { x: coords.x, y: coords.y };
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const res = await this.runCli('move', [String(coords.x), String(coords.y)]);
      return res.toLowerCase().includes('true');
    } catch {
      return this.invokeWin32(`[Gemetron.Win32Input]::MoveMouse(${coords.x}, ${coords.y})`);
    }
  }

  /**
   * Click mouse at (x, y) with optional DPI scaling
   */
  public async mouseClick(
    x: number,
    y: number,
    options: {
      button?: 'left' | 'right' | 'middle';
      double?: boolean;
      scaleWithDpi?: boolean;
      monitorId?: number;
      skipHighlight?: boolean;
    } = {},
  ): Promise<boolean> {
    const coords = this.mapCoordinates(x, y, options);
    const button = options.button || 'left';
    const double = options.double ?? false;

    const action: InputActionEvent = {
      type: 'click',
      x: coords.x,
      y: coords.y,
      button,
      double,
      skipHighlight: options.skipHighlight,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.simulatedCursor = { x: coords.x, y: coords.y };
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const res = await this.runCli('click', [
        String(coords.x),
        String(coords.y),
        button,
        double ? 'true' : 'false',
      ]);
      return res.toLowerCase().includes('true');
    } catch {
      return this.invokeWin32(
        `[Gemetron.Win32Input]::Click(${coords.x}, ${coords.y}, '${button}', ${double ? '$true' : '$false'})`,
      );
    }
  }

  /**
   * Drag mouse from (startX, startY) to (endX, endY) with optional DPI scaling
   */
  public async mouseDrag(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    steps = 10,
    options: InputCoordinateOptions = {},
  ): Promise<boolean> {
    const start = this.mapCoordinates(startX, startY, options);
    const end = this.mapCoordinates(endX, endY, options);

    const action: InputActionEvent = {
      type: 'drag',
      x: end.x,
      y: end.y,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.simulatedCursor = { x: end.x, y: end.y };
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const res = await this.runCli('drag', [
        String(start.x),
        String(start.y),
        String(end.x),
        String(end.y),
        String(steps),
      ]);
      return res.toLowerCase().includes('true');
    } catch {
      return this.invokeWin32(
        `[Gemetron.Win32Input]::Drag(${start.x}, ${start.y}, ${end.x}, ${end.y}, ${steps})`,
      );
    }
  }

  /**
   * Scroll vertical wheel (positive = up, negative = down)
   */
  public async mouseScroll(deltaY: number): Promise<boolean> {
    return this.mouseScrollAt(-1, -1, deltaY);
  }

  /**
   * Scroll vertical wheel at specific desktop coordinates
   */
  public async mouseScrollAt(x: number, y: number, deltaY: number): Promise<boolean> {
    const action: InputActionEvent = {
      type: 'scroll',
      x: x >= 0 ? x : undefined,
      y: y >= 0 ? y : undefined,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      if (x >= 0 && y >= 0) {
        const res = await this.runCli('scroll-at', [
          String(Math.round(x)),
          String(Math.round(y)),
          String(Math.round(deltaY)),
        ]);
        return res.toLowerCase().includes('true');
      } else {
        const res = await this.runCli('scroll', [String(Math.round(deltaY))]);
        return res.toLowerCase().includes('true');
      }
    } catch {
      if (x >= 0 && y >= 0) {
        return this.invokeWin32(
          `[Gemetron.Win32Input]::ScrollAt(${Math.round(x)}, ${Math.round(y)}, ${Math.round(deltaY)})`,
        );
      } else {
        return this.invokeWin32(`[Gemetron.Win32Input]::Scroll(${Math.round(deltaY)})`);
      }
    }
  }

  /**
   * Get current cursor position
   */
  public async getCursorPosition(): Promise<CursorPosition> {
    if (this.mockMode) {
      return { ...this.simulatedCursor };
    }

    try {
      let raw = '';
      try {
        raw = await this.runCli('cursor');
      } catch {
        raw = await this.evalWin32(`[Gemetron.Win32Input]::GetCursor()`);
      }

      const parts = raw.trim().split(',');
      if (parts.length >= 2) {
        const x = parseInt(parts[0] || '0', 10);
        const y = parseInt(parts[1] || '0', 10);
        this.simulatedCursor = { x, y };
        return { x, y };
      }
    } catch {}

    return { ...this.simulatedCursor };
  }

  /**
   * Type text into currently focused application with Base64 encoding
   */
  public async typeText(text: string): Promise<boolean> {
    const action: InputActionEvent = {
      type: 'type',
      text,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const b64 = Buffer.from(text, 'utf8').toString('base64');
      const res = await this.runCli('type-b64', [b64]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = text.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::SendText('${escaped}')`);
    }
  }

  /**
   * Send hotkey chord (e.g. 'Win+R', 'Alt+Tab', 'Ctrl+C', or ['Control', 'v'])
   */
  public async sendHotkey(keys: string | string[]): Promise<boolean> {
    const chord = Array.isArray(keys) ? keys.join('+') : keys;
    const action: InputActionEvent = {
      type: 'hotkey',
      keys: chord,
      timestamp: Date.now(),
    };
    this.actionHistory.push(action);
    this.emit('action', action);

    if (this.mockMode) return true;

    try {
      const res = await this.runCli('chord', [chord]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = chord.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::SendKeyChord('${escaped}')`);
    }
  }

  private runCli(action: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const exePath = join(this.scriptsDir, 'Win32Input.exe');
      if (!existsSync(exePath)) {
        return reject(new Error('Win32Input.exe not found'));
      }

      const child = spawn(exePath, [action, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Win32 CLI failed (${code}): ${stderr || stdout}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async invokeWin32(cmd: string): Promise<boolean> {
    try {
      await this.evalWin32(cmd);
      return true;
    } catch (err) {
      console.warn('[NativeInput] Win32 invoke failed:', err);
      return false;
    }
  }

  private evalWin32(snippet: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const dllPath = join(this.scriptsDir, 'Win32Input.dll');
      const csPath = join(this.scriptsDir, 'Win32Input.cs');

      const loader = existsSync(dllPath)
        ? `Add-Type -Path '${dllPath}';`
        : `Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -Path '${csPath}';`;

      const psScript = `${loader} ${snippet}`;

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`PowerShell input failed (${code}): ${stderr || stdout}`));
        }
      });

      child.on('error', reject);
    });
  }
}
