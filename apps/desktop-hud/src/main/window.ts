import { BrowserWindow, screen } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './runtime-paths.js';

const RENDERER_LOG = join(LOGS_DIR, 'renderer.log');
import type { HudDisplayMode } from './types.js';

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
      const display = screen.getPrimaryDisplay();
      const area = display.workArea;
      const b = mainWindow.getBounds();
      if (
        b.x + b.width < area.x ||
        b.x > area.x + area.width ||
        b.y + b.height < area.y ||
        b.y > area.y + area.height
      ) {
        const w = Math.min(b.width, area.width);
        const h = Math.min(b.height, area.height);
        mainWindow.setBounds({
          x: area.x + area.width - w - 40,
          y: area.y + 40,
          width: w,
          height: h,
        });
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

const DISPLAY_PRESETS: Record<HudDisplayMode, { width: number; height: number }> = {
  orb: { width: 74, height: 74 },
  bar: { width: 420, height: 62 },
  full: { width: 400, height: 600 },
  console: { width: 540, height: 700 },
};

export function getDisplayMode(): HudDisplayMode {
  return currentDisplayMode;
}

export function setDisplayMode(mode: HudDisplayMode): HudDisplayMode {
  if (mode !== 'orb' && mode !== 'bar' && mode !== 'full' && mode !== 'console') mode = 'bar';
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
  const targetWidth = mode === 'console' ? lastFullSize.width : preset.width;
  const targetHeight = mode === 'console' ? Math.min(lastFullSize.height, 900) : preset.height;

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;

  let width = targetWidth;
  let height = targetHeight;
  if (width > area.width) width = area.width;
  if (height > area.height) height = area.height;

  const right = bounds.x + bounds.width;
  let x = right - width;
  let y = bounds.y;

  if (x < area.x) x = area.x;
  if (x + width > area.x + area.width) x = area.x + area.width - width;
  if (y < area.y) y = area.y;
  if (y + height > area.y + area.height) y = area.y + area.height - height;

  win.setResizable(true);
  if (mode === 'console') win.setMinimumSize(380, 480);
  else if (mode === 'full') win.setMinimumSize(400, 600);
  else if (mode === 'bar') win.setMinimumSize(420, 62);
  else win.setMinimumSize(74, 74);
  win.setBounds({ x, y, width, height }, false);
  win.setResizable(mode === 'console');
  win.setMaximizable(mode === 'console');

  return currentDisplayMode;
}
