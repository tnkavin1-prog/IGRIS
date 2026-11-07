import { BrowserWindow, screen } from 'electron';

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
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.loadFile(htmlPath);

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
  mainWindow.setAlwaysOnTop(isPinnedAlwaysOnTop, isPinnedAlwaysOnTop ? 'screen-saver' : 'normal');
  return isPinnedAlwaysOnTop;
}

export function minimizeWindow(): void {
  mainWindow?.minimize();
}

export function closeWindow(): void {
  mainWindow?.close();
}
