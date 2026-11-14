import { BrowserWindow, screen } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './runtime-paths.js';

const RENDERER_LOG = join(LOGS_DIR, 'renderer.log');
import type { HudDisplayMode } from './types.js';
import {
  DISPLAY_PRESETS,
  clampRectIntoArea,
  isHudDisplayMode,
  isRectFullyVisible,
  resizePreservingRightEdge,
} from './display-mode.js';

let mainWindow: BrowserWindow | null = null;
let isPinnedAlwaysOnTop = true;
let currentDisplayMode: HudDisplayMode = 'bar';
let lastFullSize = { width: 540, height: 700 };

export function createMainWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  currentDisplayMode = 'bar';

  const defaultWidth = 420;
  const defaultHeight = 62;
  const initialX = Math.max(20, screenWidth - defaultWidth - 40);
  const initialY = Math.max(40, Math.floor((screenHeight - defaultHeight) / 2));

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 74,
    minHeight: 74,
    x: initialX,
    y: initialY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    skipTaskbar: false,
    title: 'Gematron',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Ensure window floats above other windows including full screen/maximized Chrome
  mainWindow.setAlwaysOnTop(true);

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      // Guarantee the window is visible on the primary display even if a
      // previous session left it off-screen (monitor change, orb collapse).
      const area = screen.getPrimaryDisplay().workArea;
      const bounds = mainWindow.getBounds();
      if (!isRectFullyVisible(bounds, area)) {
        mainWindow.setBounds(clampRectIntoArea(bounds, area, 40), false);
      }
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.moveTop();
    }
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const lineStr = `[${new Date().toISOString()}] [Renderer] [lvl ${level}] ${message} (${sourceId}:${line})\n`;
    try {
      try {
        const s = statSync(RENDERER_LOG);
        if (s.size >= 5 * 1024 * 1024) {
          try {
            unlinkSync(`${RENDERER_LOG}.1`);
          } catch {}
          renameSync(RENDERER_LOG, `${RENDERER_LOG}.1`);
        }
      } catch {}
      mkdirSync(LOGS_DIR, { recursive: true });
      appendFileSync(RENDERER_LOG, lineStr, 'utf8');
    } catch {}
    console.log(`[Renderer Console] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    const errStr = `[${new Date().toISOString()}] [DesktopHUD] Failed to load HTML: ${errorCode} - ${errorDescription}\n`;
    try {
      try {
        const s = statSync(RENDERER_LOG);
        if (s.size >= 5 * 1024 * 1024) {
          try {
            unlinkSync(`${RENDERER_LOG}.1`);
          } catch {}
          renameSync(RENDERER_LOG, `${RENDERER_LOG}.1`);
        }
      } catch {}
      mkdirSync(LOGS_DIR, { recursive: true });
      appendFileSync(RENDERER_LOG, errStr, 'utf8');
    } catch {}
    console.error(`[DesktopHUD] Failed to load HTML: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    const goneStr = `[${new Date().toISOString()}] [DesktopHUD] Render process gone: ${JSON.stringify(details)}\n`;
    try {
      try {
        const s = statSync(RENDERER_LOG);
        if (s.size >= 5 * 1024 * 1024) {
          try {
            unlinkSync(`${RENDERER_LOG}.1`);
          } catch {}
          renameSync(RENDERER_LOG, `${RENDERER_LOG}.1`);
        }
      } catch {}
      mkdirSync(LOGS_DIR, { recursive: true });
      appendFileSync(RENDERER_LOG, goneStr, 'utf8');
    } catch {}
    console.error(`[DesktopHUD] Render process gone:`, details);
  });

  mainWindow.loadFile(htmlPath);
  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function toggleMaximize(): boolean {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
}

export function toggleAlwaysOnTop(): boolean {
  if (!mainWindow) return isPinnedAlwaysOnTop;
  isPinnedAlwaysOnTop = !isPinnedAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isPinnedAlwaysOnTop);
  return isPinnedAlwaysOnTop;
}

export function minimizeWindow(): void {
  mainWindow?.minimize();
}

export function closeWindow(): void {
  mainWindow?.close();
}

export function getDisplayMode(): HudDisplayMode {
  return currentDisplayMode;
}

/**
 * Move the window back onto its display if it is not fully visible.
 *
 * Summon (tray, global shortcut, `gematron://`) must always produce a window
 * the user can actually see. Returns true when the window had to be moved.
 */
export function ensureWindowVisible(margin = 24): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const bounds = mainWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (isRectFullyVisible(bounds, area)) return false;
  mainWindow.setBounds(clampRectIntoArea(bounds, area, margin), false);
  return true;
}

export function setDisplayMode(mode: HudDisplayMode): HudDisplayMode {
  if (!isHudDisplayMode(mode)) mode = 'bar';
  if (!mainWindow || mainWindow.isDestroyed()) {
    currentDisplayMode = mode;
    return mode;
  }
  const win = mainWindow;
  const previousMode = currentDisplayMode;
  if (previousMode === 'console' && mode !== 'console') {
    const b = win.getBounds();
    if (!win.isMaximized()) {
      lastFullSize = { width: Math.max(380, b.width), height: Math.max(480, b.height) };
    }
  }
  currentDisplayMode = mode;
  if (win.isMaximized()) win.unmaximize();

  const preset = DISPLAY_PRESETS[mode];
  const target = {
    width: mode === 'console' ? lastFullSize.width : preset.width,
    height: mode === 'console' ? Math.min(lastFullSize.height, 900) : preset.height,
  };

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const next = resizePreservingRightEdge(bounds, target, display.workArea);

  win.setResizable(true);
  if (mode === 'console') win.setMinimumSize(380, 480);
  else if (mode === 'full') win.setMinimumSize(400, 600);
  else if (mode === 'bar') win.setMinimumSize(420, 62);
  else win.setMinimumSize(74, 74);
  win.setBounds(next, false);
  win.setResizable(mode === 'console');
  win.setMaximizable(mode === 'console');

  return currentDisplayMode;
}
