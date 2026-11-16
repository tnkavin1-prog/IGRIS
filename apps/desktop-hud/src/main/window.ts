import {
  BrowserWindow,
  app,
  ipcMain,
  powerMonitor,
  screen,
  systemPreferences,
  type IpcMainEvent,
} from 'electron';
import { ICON_PATH } from './runtime-paths.js';
import { appendRendererLog } from './renderer-log.js';
import { HUD_IPC, type GestureRequest, type ModeChangedPayload } from './hud-window-ipc.js';
import type { HudDisplayMode } from './types.js';
import {
  MODE_TRANSITION_MS,
  SHADOW_INSET,
  anchorFor,
  clampRectIntoArea,
  consoleWindowLimits,
  inflateRect,
  intersectRect,
  isHudDisplayMode,
  recoverRect,
  resizeAnchored,
  resizeRectByEdge,
  resolveInitialDisplayMode,
  roundRect,
  sameRect,
  snapRectToArea,
  surfaceSizeOf,
  windowSizeFor,
  type Rect,
  type ResizeEdge,
} from './display-mode.js';
import {
  flushWindowState,
  loadWindowState,
  saveWindowStateSoon,
  type WindowState,
} from './window-state.js';

/** Remember where the user parked each mode (drag-placed modes only). */
const REMEMBER_PER_MODE = true;
const GESTURE_TICK_MS = 16;
const GESTURE_MAX_MS = 120_000;
const SNAP_THRESHOLD = 18;
const SNAP_MARGIN = 12;
const GROW_DELAY_MS = 16; // lets the renderer pin the old surface size first

let mainWindow: BrowserWindow | null = null;
let isPinnedAlwaysOnTop = true;
let windowDismissed = false;
let currentDisplayMode: HudDisplayMode = 'full';
let state: WindowState = loadWindowStateSafe();
const userPlacedModes = new Set<HudDisplayMode>();
let shrinkTimer: NodeJS.Timeout | undefined;
let stopDisplayWatchers: (() => void) | null = null;
let ipcRegistered = false;

interface ActiveGesture {
  req: GestureRequest;
  startCursor: { x: number; y: number };
  startBounds: Rect;
  last: Rect;
  startedAt: number;
  timer: NodeJS.Timeout;
}
let gesture: ActiveGesture | null = null;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function loadWindowStateSafe(): WindowState {
  try {
    return loadWindowState();
  } catch {
    return { version: 1, mode: 'full', pinned: true, positions: {} };
  }
}

const allWorkAreas = (): Rect[] => screen.getAllDisplays().map((d) => d.workArea);

function alive(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
}

function send(channel: string, payload: unknown): void {
  const win = mainWindow;
  if (alive(win) && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

function persist(): void {
  state = { ...state, mode: currentDisplayMode, pinned: isPinnedAlwaysOnTop };
  saveWindowStateSoon(state);
}

function richAnimations(): boolean {
  try {
    return systemPreferences.getAnimationSettings().shouldRenderRichAnimation;
  } catch {
    return true;
  }
}

/** setBounds + mixed-DPI drift fix (Electron can land 1px off at fractional scales). */
function applyBounds(win: BrowserWindow, rect: Rect): void {
  const r = roundRect(rect);
  win.setBounds(r, false);
  const got = win.getBounds();
  if (got.width !== r.width || got.height !== r.height) win.setBounds(r, false);
}

function fadeTo(win: BrowserWindow, target: number, ms: number, done?: () => void): void {
  const start = win.getOpacity();
  const t0 = Date.now();
  const step = () => {
    if (win.isDestroyed()) return;
    const p = Math.min(1, (Date.now() - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    win.setOpacity(start + (target - start) * eased);
    if (p < 1) setTimeout(step, 16);
    else done?.();
  };
  step();
}

/** Always-on-top that survives focus changes / shell restarts / resume. */
function assertTopmost(): void {
  const win = mainWindow;
  if (!alive(win) || !isPinnedAlwaysOnTop) return;
  win.setAlwaysOnTop(true, 'screen-saver'); // highest non-exclusive z-band on Windows
  win.moveTop(); // z-order only, does not steal focus
}

/* ------------------------------------------------------------------ */
/* creation                                                            */
/* ------------------------------------------------------------------ */

function initialBounds(mode: HudDisplayMode): Rect {
  const size = windowSizeFor(mode, state.consoleSize);
  const primary = screen.getPrimaryDisplay().workArea; // NOTE: honour x/y origin
  const fallback: Rect = {
    x: primary.x + primary.width - size.width - 40 + SHADOW_INSET,
    y: primary.y + Math.max(40, Math.floor((primary.height - size.height) / 2)),
    ...size,
  };
  const saved = state.positions[mode];
  const rect = saved ? { ...saved, ...size } : fallback;
  return recoverRect(rect, allWorkAreas(), 24);
}

export function createMainWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  // Singleton guard FIRST: a second summon must not reset live mode state.
  if (alive(mainWindow)) {
    presentWindow();
    return mainWindow;
  }

  state = loadWindowStateSafe();
  isPinnedAlwaysOnTop = state.pinned;
  windowDismissed = false;
  currentDisplayMode = resolveInitialDisplayMode(state.mode);
  userPlacedModes.clear();
  for (const k of Object.keys(state.positions)) {
    if (isHudDisplayMode(k)) userPlacedModes.add(k);
  }

  const b = initialBounds(currentDisplayMode);

  const win = new BrowserWindow({
    ...b,
    minWidth: 1, // geometry is owned by display-mode.ts; never juggle min sizes
    minHeight: 1,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // no-op on transparent Windows windows; shadow is CSS
    roundedCorners: false, // keep DWM from clipping the transparent gutter
    alwaysOnTop: isPinnedAlwaysOnTop,
    resizable: false, // resize is driven by our own handles (see gestures)
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: 'Gematron',
    icon: ICON_PATH,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // P2: bundle preload and flip to true
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  assertTopmost();

  registerWindowIpc();
  stopDisplayWatchers = watchDisplays();
  app.once('before-quit', flushWindowState);

  win.once('ready-to-show', () => {
    appendRendererLog(`[Window] ready-to-show (dismissed=${windowDismissed})`);
    if (!windowDismissed) presentWindow();
  });
  // If the renderer never reports ready (load failure), still surface the window.
  setTimeout(() => {
    appendRendererLog(
      `[Window] startup fallback (alive=${alive(win)}, dismissed=${windowDismissed}, visible=${alive(win) ? win.isVisible() : false})`,
    );
    if (alive(win) && !windowDismissed && !win.isVisible()) presentWindow();
  }, 3000);
  // A startup fallback must never undo a close action made during startup.
  win.on('close', () => {
    appendRendererLog('[Window] close event');
    windowDismissed = true;
  });
  win.on('show', () => appendRendererLog('[Window] show event'));
  win.on('hide', () => appendRendererLog('[Window] hide event'));

  win.on('moved', () => {
    // Native moves (Win+Shift+arrows, accessibility tools). Our own drag uses gestures.
    if (gesture) return;
    ensureWindowVisible(24);
    const nb = win.getBounds();
    state = { ...state, positions: { ...state.positions, [currentDisplayMode]: { x: nb.x, y: nb.y } } };
    userPlacedModes.add(currentDisplayMode);
    persist();
  });
  win.on('blur', () => setTimeout(assertTopmost, 150));
  const emitVisibility = (visible: boolean) => send(HUD_IPC.visibility, { visible });
  win.on('show', () => emitVisibility(true));
  win.on('restore', () => emitVisibility(true));
  win.on('hide', () => emitVisibility(false));
  win.on('minimize', () => emitVisibility(false));

  // Lock down navigation: a floating assistant never navigates or spawns windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    appendRendererLog(`[Renderer] [lvl ${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    appendRendererLog(`[DesktopHUD] Failed to load HTML: ${code} - ${desc}`);
    console.error(`[DesktopHUD] Failed to load HTML: ${code} - ${desc}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    appendRendererLog(`[DesktopHUD] Render process gone: ${JSON.stringify(details)}`);
    console.error('[DesktopHUD] Render process gone:', details);
  });

  win.on('closed', () => {
    appendRendererLog('[Window] closed event');
    stopDisplayWatchers?.();
    stopDisplayWatchers = null;
    endGesture();
    if (shrinkTimer) clearTimeout(shrinkTimer);
    flushWindowState();
    mainWindow = null;
  });

  void win.loadFile(htmlPath);
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/* ------------------------------------------------------------------ */
/* summon / dismiss (call these from tray, global shortcut, gematron://) */
/* ------------------------------------------------------------------ */

export function presentWindow(opts: { focus?: boolean } = {}): void {
  const win = mainWindow;
  if (!alive(win)) return;
  appendRendererLog(`[Window] present requested (visible=${win.isVisible()})`);
  windowDismissed = false;
  if (win.isMinimized()) win.restore();
  ensureWindowVisible(24);

  // A fade-out interrupted by minimize/restore can leave a visible HWND at
  // zero opacity. Explicit summons must reset opacity, not trust isVisible().
  win.setOpacity(1);
  if (!win.isVisible()) {
    if (opts.focus === false) win.showInactive();
    else win.show();
  }
  if (opts.focus !== false) win.focus();
  assertTopmost();
  appendRendererLog(`[Window] visibility restored (visible=${win.isVisible()}, opacity=${win.getOpacity()}, minimized=${win.isMinimized()})`);
}

export function hideWindow(): void {
  const win = mainWindow;
  if (!alive(win) || !win.isVisible()) return;
  fadeTo(win, 0, 110, () => {
    if (win.isDestroyed()) return;
    win.hide();
    win.setOpacity(1);
  });
}

/* ------------------------------------------------------------------ */
/* legacy controls                                                     */
/* ------------------------------------------------------------------ */

export function toggleMaximize(): boolean {
  const win = mainWindow;
  if (!alive(win) || currentDisplayMode !== 'console') return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
}

export function toggleAlwaysOnTop(): boolean {
  const win = mainWindow;
  if (!alive(win)) return isPinnedAlwaysOnTop;
  isPinnedAlwaysOnTop = !isPinnedAlwaysOnTop;
  if (isPinnedAlwaysOnTop) assertTopmost();
  else win.setAlwaysOnTop(false);
  persist();
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

/* ------------------------------------------------------------------ */
/* visibility / recovery                                               */
/* ------------------------------------------------------------------ */

/**
 * Pull the window back onto a display if it is off-screen, straddling two
 * displays, or the wrong size (mixed-DPI drift). Returns true if bounds changed.
 */
export function ensureWindowVisible(margin = 24): boolean {
  const win = mainWindow;
  if (!alive(win) || gesture) return false;
  const bounds = win.getBounds();
  const size =
    currentDisplayMode === 'console'
      ? { width: bounds.width, height: bounds.height }
      : windowSizeFor(currentDisplayMode);
  const next = roundRect(recoverRect({ x: bounds.x, y: bounds.y, ...size }, allWorkAreas(), margin));
  if (sameRect(next, bounds)) return false;
  applyBounds(win, next);
  persist();
  return true;
}

function watchDisplays(): () => void {
  let t: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      ensureWindowVisible(24);
      assertTopmost();
    }, 250); // displays settle in bursts; debounce
  };
  const bus = screen as unknown as NodeJS.EventEmitter;
  const pm = powerMonitor as unknown as NodeJS.EventEmitter;
  const screenEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  const powerEvents = ['resume', 'unlock-screen'];
  screenEvents.forEach((e) => bus.on(e, schedule));
  powerEvents.forEach((e) => pm.on(e, schedule));
  return () => {
    if (t) clearTimeout(t);
    screenEvents.forEach((e) => bus.removeListener(e, schedule));
    powerEvents.forEach((e) => pm.removeListener(e, schedule));
  };
}

/* ------------------------------------------------------------------ */
/* display modes (animated)                                            */
/* ------------------------------------------------------------------ */

export function setDisplayMode(mode: HudDisplayMode): HudDisplayMode {
  if (!isHudDisplayMode(mode)) mode = 'bar';
  const win = mainWindow;
  if (!alive(win)) {
    currentDisplayMode = mode;
    return mode;
  }
  if (mode === currentDisplayMode) return mode;

  endGesture();
  if (shrinkTimer) clearTimeout(shrinkTimer);
  if (win.isMaximized()) win.unmaximize();

  const from = currentDisplayMode;
  const bounds = win.getBounds();
  if (from === 'console') state = { ...state, consoleSize: { width: bounds.width, height: bounds.height } };
  currentDisplayMode = mode;

  const workArea = screen.getDisplayMatching(bounds).workArea;
  const area = inflateRect(workArea, SHADOW_INSET);
  const size = windowSizeFor(mode, state.consoleSize);
  const anchor = anchorFor(bounds, area);

  const saved = REMEMBER_PER_MODE && userPlacedModes.has(mode) ? state.positions[mode] : undefined;
  const next = roundRect(
    saved
      ? recoverRect({ ...saved, ...size }, allWorkAreas(), 0)
      : resizeAnchored(bounds, size, area, 0, anchor),
  );

  const growing = next.width * next.height >= bounds.width * bounds.height;
  const durationMs = richAnimations() ? MODE_TRANSITION_MS : 0;
  const payload: ModeChangedPayload = {
    from,
    to: mode,
    growing,
    anchorX: anchor.x,
    anchorY: anchor.y,
    fromSurface: surfaceSizeOf(bounds),
    toSurface: surfaceSizeOf(next),
    durationMs,
  };
  send(HUD_IPC.modeChanged, payload);

  // Grow: enlarge the (transparent) window first, the surface then morphs into it.
  // Shrink: let the surface morph down first, then drop the window around it.
  const delay = durationMs === 0 ? 0 : growing || saved ? GROW_DELAY_MS : durationMs + 40;
  shrinkTimer = setTimeout(() => {
    if (!alive(win)) return;
    applyBounds(win, next);
    persist();
  }, delay);

  return currentDisplayMode;
}

/* ------------------------------------------------------------------ */
/* drag / resize gestures (main-process cursor polling)                */
/* ------------------------------------------------------------------ */
/*
 * Why not -webkit-app-region: drag regions swallow pointer events (no
 * click-vs-drag), cannot snap, and frameless windows change size when dragged
 * across mixed-DPI monitors. Polling screen.getCursorScreenPoint() in main
 * and re-asserting the exact size every tick fixes all three.
 */

const EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

function parseGesture(v: unknown): GestureRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'move') return { kind: 'move', snap: o.snap !== false };
  if (o.kind === 'resize' && typeof o.edge === 'string' && EDGES.has(o.edge)) {
    return { kind: 'resize', edge: o.edge as ResizeEdge };
  }
  return null;
}

function beginGesture(req: GestureRequest): void {
  const win = mainWindow;
  if (!alive(win)) return;
  endGesture();
  if (req.kind === 'resize' && currentDisplayMode !== 'console') return;
  win.setIgnoreMouseEvents(false);
  const startBounds = win.getBounds();
  gesture = {
    req,
    startCursor: screen.getCursorScreenPoint(),
    startBounds,
    last: startBounds,
    startedAt: Date.now(),
    timer: setInterval(tickGesture, GESTURE_TICK_MS),
  };
}

function tickGesture(): void {
  const g = gesture;
  const win = mainWindow;
  if (!g || !alive(win) || Date.now() - g.startedAt > GESTURE_MAX_MS) {
    endGesture();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - g.startCursor.x;
  const dy = cursor.y - g.startCursor.y;
  let next: Rect;

  if (g.req.kind === 'move') {
    const wa = screen.getDisplayNearestPoint(cursor).workArea; // follows the cursor across monitors
    next = { ...g.startBounds, x: g.startBounds.x + dx, y: g.startBounds.y + dy };
    if (g.req.snap !== false) {
      next = snapRectToArea(next, wa, { threshold: SNAP_THRESHOLD, margin: SNAP_MARGIN }).rect;
    }
    next = clampRectIntoArea(next, inflateRect(wa, SHADOW_INSET));
  } else {
    const wa = screen.getDisplayMatching(g.startBounds).workArea;
    const { min, max } = consoleWindowLimits();
    next = intersectRect(
      resizeRectByEdge(g.startBounds, g.req.edge, dx, dy, min, max),
      inflateRect(wa, SHADOW_INSET),
    );
  }

  next = roundRect(next);
  if (sameRect(next, g.last)) return;
  g.last = next;
  win.setBounds(next, false); // always passes full size => no DPI size drift
}

function endGesture(): void {
  const g = gesture;
  if (!g) return;
  gesture = null;
  clearInterval(g.timer);
  const win = mainWindow;
  if (!alive(win)) return;
  const b = win.getBounds();
  if (g.req.kind === 'move') {
    state = { ...state, positions: { ...state.positions, [currentDisplayMode]: { x: b.x, y: b.y } } };
    userPlacedModes.add(currentDisplayMode);
  } else {
    state = { ...state, consoleSize: { width: b.width, height: b.height } };
  }
  persist();
}

function fromMainWindow(e: IpcMainEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents;
}

function registerWindowIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.on(HUD_IPC.gestureStart, (e, payload: unknown) => {
    if (!fromMainWindow(e)) return;
    const req = parseGesture(payload);
    if (req) beginGesture(req);
  });
  ipcMain.on(HUD_IPC.gestureEnd, (e) => {
    if (fromMainWindow(e)) endGesture();
  });
  // Click-through in the transparent gutter (renderer hit-tests, we toggle).
  ipcMain.on(HUD_IPC.setIgnoreMouse, (e, ignore: unknown) => {
    if (!fromMainWindow(e) || gesture || !alive(mainWindow)) return;
    if (ignore === true) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else mainWindow.setIgnoreMouseEvents(false);
  });
}
