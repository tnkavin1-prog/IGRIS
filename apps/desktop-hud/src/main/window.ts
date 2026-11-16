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

/* ========================================================================
   FLAGSHIP-LEVEL CONFIGURATION
   ======================================================================== */
// Remember where the user parked each mode (drag-placed modes only).
const REMEMBER_PER_MODE = true;
const GESTURE_TICK_MS = 16;
const GESTURE_MAX_MS = 120_000;
const SNAP_THRESHOLD = 18;
const SNAP_MARGIN = 12;
const GROW_DELAY_MS = 16;

// Startup guard: re-assert visibility every 400ms for up to 10s.
const STARTUP_GUARD_INTERVAL_MS = 400;
const STARTUP_GUARD_MAX_MS = 10_000;

// Renderer paint probe interval.
const PAINT_PROBE_INTERVAL_MS = 2500;

// DPI scale factor cache.
let DPI_SCALE = 1;

// Opacity fade cancellation token.
let fadeToken = 0;

// Track whether the renderer has painted its first frame.
let paintedOnce = false;

// Suppress ensureWindowVisible feedback loop during programmatic setBounds.
let suppressMovedUntil = 0;

// Window state.
let mainWindow: BrowserWindow | null = null;
let isPinnedAlwaysOnTop = true;
let windowDismissed = false;
let currentDisplayMode: HudDisplayMode = 'full';
let state: WindowState = loadWindowStateSafe();
const userPlacedModes = new Set<HudDisplayMode>();
let shrinkTimer: NodeJS.Timeout | undefined;
let stopDisplayWatchers: (() => void) | null = null;
let ipcRegistered = false;
let startupGuardTimer: NodeJS.Timeout | undefined;
let paintProbeTimer: NodeJS.Timeout | undefined;

interface ActiveGesture {
  req: GestureRequest;
  startCursor: { x: number; y: number };
  startBounds: Rect;
  last: Rect;
  startedAt: number;
  timer: NodeJS.Timeout;
}
let gesture: ActiveGesture | null = null;

/* ========================================================================
   STATE SANITISATION
   ======================================================================== */

function loadWindowStateSafe(): WindowState {
  try {
    return sanitizeState(loadWindowState());
  } catch {
    return { version: 1, mode: 'full', pinned: true, positions: {} };
  }
}

function sanitizeState(raw: WindowState): WindowState {
  const out: WindowState = {
    version: raw.version ?? 1,
    mode: isHudDisplayMode(raw.mode) ? raw.mode : 'full',
    pinned: typeof raw.pinned === 'boolean' ? raw.pinned : true,
    consoleSize: undefined,
    positions: {},
  };

  // Console size validation.
  const cs = raw.consoleSize;
  if (
    cs &&
    typeof cs.width === 'number' &&
    typeof cs.height === 'number' &&
    Number.isFinite(cs.width) &&
    Number.isFinite(cs.height) &&
    cs.width > 0 &&
    cs.height > 0 &&
    cs.width < 4096 &&
    cs.height < 4096
  ) {
    out.consoleSize = { width: cs.width, height: cs.height };
  }

  // Position validation - drop NaN/absurd coords.
  const pos = raw.positions;
  if (pos && typeof pos === 'object') {
    for (const m of Object.keys(pos) as HudDisplayMode[]) {
      if (!isHudDisplayMode(m)) continue;
      const p = pos[m];
      if (
        p &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Math.abs(p.x) < 100_000 &&
        Math.abs(p.y) < 100_000
      ) {
        out.positions[m] = { x: p.x, y: p.y };
      }
    }
  }

  return out;
}

/* ========================================================================
   DPI SCALING
   ======================================================================== */

function updateDpiScale(): void {
  const primary = screen.getPrimaryDisplay();
  DPI_SCALE = primary.scaleFactor ?? 1;
}

function scaleForDpi(value: number): number {
  return Math.round(value * DPI_SCALE);
}

/* ========================================================================
   OPACITY - ALL WRITES ROUTED HERE
   ======================================================================== */

function setWindowOpacity(win: BrowserWindow, opacity: number): void {
  // On transparent Windows, setOpacity can blank the layered window.
  // Guard against writing opacity 0 to a transparent window.
  const clamped = Math.max(0, Math.min(1, opacity));
  try {
    win.setOpacity(clamped);
  } catch {
    // setOpacity may throw on some platforms; ignore.
  }
}

/* ========================================================================
   HELPERS
   ======================================================================== */

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

/** setBounds + mixed-DPI drift fix. Rejects degenerate rects (0x0 / NaN). */
function applyBounds(win: BrowserWindow, rect: Rect): void {
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 4096 || h > 4096) {
    appendRendererLog(`[Window] applyBounds rejected degenerate rect: ${JSON.stringify(rect)}`);
    return;
  }
  const r = roundRect({ x: rect.x, y: rect.y, width: w, height: h });
  win.setBounds(r, false);
  const got = win.getBounds();
  if (got.width !== r.width || got.height !== r.height) win.setBounds(r, false);
}

/** Fade with cancellation token - prevents orphaned fades hiding the window. */
function fadeTo(
  win: BrowserWindow,
  target: number,
  ms: number,
  done?: () => void,
): void {
  const token = ++fadeToken;
  const start = win.getOpacity();
  const t0 = Date.now();
  const step = () => {
    if (token !== fadeToken) return; // cancelled
    if (win.isDestroyed()) return;
    const p = Math.min(1, (Date.now() - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    setWindowOpacity(win, start + (target - start) * eased);
    if (p < 1) {
      setTimeout(step, 16);
    } else {
      done?.();
    }
  };
  step();
}

function cancelFade(): void {
  fadeToken++;
}

/** Always-on-top that survives focus changes / shell restarts / resume. */
function assertTopmost(): void {
  const win = mainWindow;
  if (!alive(win) || !isPinnedAlwaysOnTop) return;
  win.setAlwaysOnTop(true, 'screen-saver'); // highest non-exclusive z-band on Windows
  win.moveTop(); // z-order only, does not steal focus
}

/** Mirror [Window] log lines to stdout for visibility during debugging. */
function logBoth(message: string): void {
  appendRendererLog(message);
  try {
    process.stdout.write(message + '\n');
  } catch {
    // stdout may not be available in packaged builds.
  }
}

/* ========================================================================
   RENDERER PAINT PROBE
   ======================================================================== */

function probeRendererPaint(win: BrowserWindow): void {
  if (!alive(win)) return;
  win.webContents.executeJavaScript('document.readyState').then((state) => {
    if (!alive(win)) return;
    if (state === 'complete' && !paintedOnce) {
      paintedOnce = true;
      logBoth('[Window] renderer paint confirmed');
      // Enable click-through now that renderer has painted.
      if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(false);
      }
    }
  });
}

/* ========================================================================
   CREATION
   ======================================================================== */

function initialBounds(mode: HudDisplayMode): Rect {
  updateDpiScale();
  const size = windowSizeFor(mode, state.consoleSize);
  const primary = screen.getPrimaryDisplay().workArea;
  const fallback: Rect = {
    x: scaleForDpi(primary.x + primary.width - size.width - 40 + SHADOW_INSET),
    y: scaleForDpi(primary.y + Math.max(40, Math.floor((primary.height - size.height) / 2))),
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
    minWidth: 1,
    minHeight: 1,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: isPinnedAlwaysOnTop,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: 'Gematron',
    icon: ICON_PATH,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      // GPU acceleration for fast rendering.
      offscreen: false,
    },
  });
  mainWindow = win;
  assertTopmost();

  registerWindowIpc();
  stopDisplayWatchers = watchDisplays();
  app.once('before-quit', flushWindowState);

  // Startup guard - re-assert visibility without fighting user intent.
  let guardTicks = 0;
  const maxGuardTicks = STARTUP_GUARD_MAX_MS / STARTUP_GUARD_INTERVAL_MS;
  startupGuardTimer = setInterval(() => {
    guardTicks++;
    if (!alive(win) || windowDismissed) {
      clearInterval(startupGuardTimer as NodeJS.Timeout);
      startupGuardTimer = undefined;
      return;
    }
    if (!win.isVisible() || win.getOpacity() === 0) {
      presentWindow({ focus: false });
    }
    if (guardTicks >= maxGuardTicks) {
      clearInterval(startupGuardTimer as NodeJS.Timeout);
      startupGuardTimer = undefined;
    }
  }, STARTUP_GUARD_INTERVAL_MS);

  win.once('ready-to-show', () => {
    logBoth(`[Window] ready-to-show (dismissed=${windowDismissed})`);
    if (!windowDismissed) presentWindow({ focus: false });
    probeRendererPaint(win);
  });

  // Renderer paint probe at +2.5s.
  paintProbeTimer = setTimeout(() => {
    if (alive(win)) probeRendererPaint(win);
  }, 2500);

  // If the renderer never reports ready (load failure), still surface the window.
  setTimeout(() => {
    appendRendererLog(
      `[Window] startup fallback (alive=${alive(win)}, dismissed=${windowDismissed}, visible=${alive(win) ? win.isVisible() : false})`,
    );
    if (alive(win) && !windowDismissed && !win.isVisible()) presentWindow({ focus: false });
  }, 3000);

  win.on('close', () => {
    logBoth('[Window] close event');
    windowDismissed = true;
  });
  win.on('show', () => appendRendererLog('[Window] show event'));
  win.on('hide', () => appendRendererLog('[Window] hide event'));

  win.on('moved', () => {
    if (suppressMovedUntil > 0 && Date.now() < suppressMovedUntil) return;
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

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    appendRendererLog(`[Renderer] [lvl ${level}] ${message} (${sourceId}:${line})`);
    try {
      console.error(`[Renderer] [lvl ${level}] ${message} (${sourceId}:${line})`);
    } catch {}
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    appendRendererLog(`[DesktopHUD] Failed to load HTML: ${code} - ${desc}`);
    console.error(`[DesktopHUD] Failed to load HTML: ${code} - ${desc}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    appendRendererLog(`[DesktopHUD] Render process gone: ${JSON.stringify(details)}`);
    console.error('[DesktopHUD] Render process gone:', details);
    // Crash recovery: attempt to reload instead of dying.
    if (alive(win)) {
      setTimeout(() => {
        if (alive(win) && !win.isDestroyed()) {
          void win.loadFile(htmlPath).catch(() => {});
        }
      }, 1000);
    }
  });

  win.on('closed', () => {
    logBoth('[Window] closed event');
    stopDisplayWatchers?.();
    stopDisplayWatchers = null;
    endGesture();
    if (shrinkTimer) clearTimeout(shrinkTimer);
    if (startupGuardTimer) clearInterval(startupGuardTimer);
    if (paintProbeTimer) clearTimeout(paintProbeTimer);
    flushWindowState();
    mainWindow = null;
  });

  void win.loadFile(htmlPath);
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/* ========================================================================
   SUMMON / DISMISS
   ======================================================================== */

export function presentWindow(opts: { focus?: boolean } = {}): void {
  const win = mainWindow;
  if (!alive(win)) return;
  logBoth(`[Window] present requested (visible=${win.isVisible()})`);
  windowDismissed = false;
  cancelFade(); // cancel any in-flight fade-out
  if (win.isMinimized()) win.restore();
  ensureWindowVisible(24);

  // Reset opacity via the guarded setter.
  setWindowOpacity(win, 1);
  if (!win.isVisible()) {
    if (opts.focus === false) win.showInactive();
    else win.show();
  }
  if (opts.focus !== false) win.focus();
  assertTopmost();
  logBoth(
    `[Window] visibility restored (visible=${win.isVisible()}, opacity=${win.getOpacity()}, minimized=${win.isMinimized()})`,
  );
}

export function hideWindow(): void {
  const win = mainWindow;
  if (!alive(win) || !win.isVisible()) return;
  windowDismissed = true;
  fadeTo(win, 0, 110, () => {
    if (win.isDestroyed()) return;
    win.hide();
    setWindowOpacity(win, 1);
  });
}

/* ========================================================================
   LEGACY CONTROLS
   ======================================================================== */

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

/* ========================================================================
   VISIBILITY / RECOVERY
   ======================================================================== */

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
  suppressMovedUntil = Date.now() + 500; // suppress feedback loop for 500ms
  applyBounds(win, next);
  persist();
  return true;
}

export function getWindowDiagnostics(): Record<string, unknown> {
  const win = mainWindow;
  if (!alive(win)) return { alive: false };
  const bounds = win.getBounds();
  return {
    alive: true,
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    focused: win.isFocused(),
    alwaysOnTop: win.isAlwaysOnTop(),
    opacity: win.getOpacity(),
    bounds,
    dpiScale: DPI_SCALE,
    fadeToken,
    paintedOnce,
    displayMode: currentDisplayMode,
    windowDismissed,
  };
}

function watchDisplays(): () => void {
  let t: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      updateDpiScale();
      ensureWindowVisible(24);
      assertTopmost();
    }, 250);
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

/* ========================================================================
   DISPLAY MODES (ANIMATED)
   ======================================================================== */

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

  const delay = durationMs === 0 ? 0 : growing || saved ? GROW_DELAY_MS : durationMs + 40;
  shrinkTimer = setTimeout(() => {
    if (!alive(win)) return;
    suppressMovedUntil = Date.now() + 500;
    applyBounds(win, next);
    persist();
  }, delay);

  return currentDisplayMode;
}

/* ========================================================================
   DRAG / RESIZE GESTURES
   ======================================================================== */

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
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
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
  suppressMovedUntil = Date.now() + 500;
  win.setBounds(next, false);
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
  // Never go click-through before the renderer has actually painted something.
  ipcMain.on(HUD_IPC.setIgnoreMouse, (e, ignore: unknown) => {
    if (!fromMainWindow(e) || gesture || !alive(mainWindow)) return;
    if (ignore === true && paintedOnce) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else mainWindow.setIgnoreMouseEvents(false);
  });
}
