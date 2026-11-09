import { BrowserWindow, screen } from 'electron';
import { appendFileSync } from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let isPinnedAlwaysOnTop = true;

export function createMainWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const defaultWidth = 440;
  const defaultHeight = 680;
  const initialX = Math.max(20, screenWidth - defaultWidth - 40);
  const initialY = Math.max(40, Math.floor((screenHeight - defaultHeight) / 2));

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 380,
    minHeight: 480,
    x: initialX,
    y: initialY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    skipTaskbar: false,
    title: 'Gemini Browser Live HUD',
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
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.moveTop();
    }
  });

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const lineStr = `[${new Date().toISOString()}] [Renderer] [lvl ${level}] ${message} (${sourceId}:${line})\n`;
    try {
      appendFileSync('E:\\Gematron\\logs\\renderer.log', lineStr);
    } catch {}
    console.log(`[Renderer Console] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    const errStr = `[${new Date().toISOString()}] [DesktopHUD] Failed to load HTML: ${errorCode} - ${errorDescription}\n`;
    try {
      appendFileSync('E:\\Gematron\\logs\\renderer.log', errStr);
    } catch {}
    console.error(`[DesktopHUD] Failed to load HTML: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    const goneStr = `[${new Date().toISOString()}] [DesktopHUD] Render process gone: ${JSON.stringify(details)}\n`;
    try {
      appendFileSync('E:\\Gematron\\logs\\renderer.log', goneStr);
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
