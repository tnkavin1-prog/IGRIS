import type { HudDisplayMode } from './types.js';

/**
 * Pure display-mode geometry for the desktop HUD window.
 * No Electron imports: everything here is unit-testable.
 *
 * Coordinate convention: "window rect" = the BrowserWindow bounds (DIPs).
 * "surface" = the visible HUD card, which sits inside a transparent gutter of
 * SHADOW_INSET px on every side so the CSS drop shadow is not clipped.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type AnchorX = 'left' | 'right';
export type AnchorY = 'top' | 'bottom';
export interface Anchor {
  x: AnchorX;
  y: AnchorY;
}

/**
 * Transparent gutter around the visible surface (px). MUST match
 * `--hud-inset` in hud-polish.css. Set to 0 to revert to the legacy
 * "window == surface" behaviour.
 */
export const SHADOW_INSET = 16;

/** Surface morph duration shared by main + renderer. */
export const MODE_TRANSITION_MS = 220;

/** Visible-surface size per mode (what users perceive). */
export const DISPLAY_PRESETS: Record<HudDisplayMode, Size> = {
  orb: { width: 74, height: 74 },
  bar: { width: 420, height: 62 },
  full: { width: 400, height: 600 },
  console: { width: 540, height: 700 },
};

/** Console is the only resizable mode (visible-surface limits). */
export const CONSOLE_LIMITS = {
  min: { width: 380, height: 480 },
  max: { width: 960, height: 1000 },
} as const;

export function isHudDisplayMode(value: unknown): value is HudDisplayMode {
  return value === 'orb' || value === 'bar' || value === 'full' || value === 'console';
}

/**
 * Only the full window (full/console) is a real launch state: bar and orb are
 * deliberate collapse actions. Restoring them on startup made the window look
 * like it vanished.
 */
export function resolveInitialDisplayMode(_saved: unknown): HudDisplayMode {
  // The HUD always launches into the full floating window; console/bar/orb are
  // deliberate in-session collapse actions and must not be restored on startup.
  return 'full';
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function inflateRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

export function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Window-level min/max for the resizable console. */
export function consoleWindowLimits(): { min: Size; max: Size } {
  const g = SHADOW_INSET * 2;
  return {
    min: {
      width: CONSOLE_LIMITS.min.width + g,
      height: CONSOLE_LIMITS.min.height + g,
    },
    max: {
      width: CONSOLE_LIMITS.max.width + g,
      height: CONSOLE_LIMITS.max.height + g,
    },
  };
}

/**
 * BrowserWindow size for a mode. For `console`, `savedWindowSize` is the
 * user's last window size (window coordinates, gutter included).
 */
export function windowSizeFor(mode: HudDisplayMode, savedWindowSize?: Size): Size {
  if (mode === 'console' && savedWindowSize) {
    const { min, max } = consoleWindowLimits();
    return {
      width: clamp(Math.round(savedWindowSize.width), min.width, max.width),
      height: clamp(Math.round(savedWindowSize.height), min.height, max.height),
    };
  }
  const p = DISPLAY_PRESETS[mode];
  return { width: p.width + SHADOW_INSET * 2, height: p.height + SHADOW_INSET * 2 };
}

export function surfaceSizeOf(windowSize: Size): Size {
  return {
    width: Math.max(0, windowSize.width - SHADOW_INSET * 2),
    height: Math.max(0, windowSize.height - SHADOW_INSET * 2),
  };
}

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

/** True when the rect lies entirely inside the area. */
export function isRectFullyVisible(bounds: Rect, area: Rect): boolean {
  return (
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  );
}

/** True when the rect shares any pixel with the area. */
export function isRectVisible(bounds: Rect, area: Rect): boolean {
  return (
    bounds.x + bounds.width > area.x &&
    bounds.x < area.x + area.width &&
    bounds.y + bounds.height > area.y &&
    bounds.y < area.y + area.height
  );
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function intersectRect(rect: Rect, area: Rect): Rect {
  const left = Math.max(rect.x, area.x);
  const top = Math.max(rect.y, area.y);
  const right = Math.min(rect.x + rect.width, area.x + area.width);
  const bottom = Math.min(rect.y + rect.height, area.y + area.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** The area the rect overlaps most (ties / no overlap: nearest centre). */
export function nearestArea(rect: Rect, areas: Rect[]): Rect | undefined {
  let best: Rect | undefined;
  let bestOverlap = -1;
  let bestDist = Infinity;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (const a of areas) {
    const o = overlapArea(rect, a);
    const d = Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy);
    if (o > bestOverlap || (o === bestOverlap && d < bestDist)) {
      best = a;
      bestOverlap = o;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Multi-monitor recovery. If the window surface is fully inside ONE work area
 * it is left untouched; otherwise (monitor unplugged, resolution change,
 * straddling two displays) it is clamped into the display it overlaps most.
 * `margin` is the visible-surface margin from the work-area edge.
 */
export function recoverRect(
  rect: Rect,
  workAreas: Rect[],
  margin = 0,
  inset = SHADOW_INSET,
): Rect {
  if (workAreas.length === 0) return rect;
  const inflated = workAreas.map((a) => inflateRect(a, inset));
  if (inflated.some((a) => isRectFullyVisible(rect, a))) return rect;
  const target = nearestArea(rect, inflated);
  return target ? clampRectIntoArea(rect, target, margin) : rect;
}

/* ------------------------------------------------------------------ */
/* Clamp / resize                                                      */
/* ------------------------------------------------------------------ */

/**
 * Clamp a rect into the area, shrinking it when it is larger than the
 * display. Position is nudged only as far as necessary.
 */
export function clampRectIntoArea(bounds: Rect, area: Rect, margin = 0): Rect {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const slack = Math.max(0, Math.floor(Math.min(area.width, area.height) / 2));
  const inset = Math.min(Math.max(0, margin), slack);
  return {
    x: clamp(bounds.x, area.x + inset, area.x + area.width - inset - width),
    y: clamp(bounds.y, area.y + inset, area.y + area.height - inset - height),
    width,
    height,
  };
}

/** Legacy: resize keeping the right edge and top. Kept for compatibility. */
export function resizePreservingRightEdge(
  current: Rect,
  target: Size,
  area: Rect,
  margin = 0,
): Rect {
  const width = Math.min(target.width, area.width);
  const height = Math.min(target.height, area.height);
  const slack = Math.max(0, Math.floor(Math.min(area.width, area.height) / 2));
  const inset = Math.min(Math.max(0, margin), slack);
  const right = current.x + current.width;
  return {
    x: clamp(right - width, area.x + inset, area.x + area.width - inset - width),
    y: clamp(current.y, area.y + inset, area.y + area.height - inset - height),
    width,
    height,
  };
}

/** The corner the window is closest to: it grows/shrinks toward/from there. */
export function anchorFor(current: Rect, area: Rect): Anchor {
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  return {
    x: cx > area.x + area.width / 2 ? 'right' : 'left',
    y: cy > area.y + area.height / 2 ? 'bottom' : 'top',
  };
}

/**
 * Resize to `target` while keeping the anchored corner stationary. An orb
 * parked bottom-left expands up-and-right; bottom-right expands up-and-left.
 */
export function resizeAnchored(
  current: Rect,
  target: Size,
  area: Rect,
  margin = 0,
  anchor: Anchor = anchorFor(current, area),
): Rect {
  const width = Math.min(target.width, area.width);
  const height = Math.min(target.height, area.height);
  const x = anchor.x === 'right' ? current.x + current.width - width : current.x;
  const y = anchor.y === 'bottom' ? current.y + current.height - height : current.y;
  return clampRectIntoArea({ x, y, width, height }, area, margin);
}

/* ------------------------------------------------------------------ */
/* Magnetic snapping                                                   */
/* ------------------------------------------------------------------ */

export interface SnapOptions {
  /** Capture distance in px. */
  threshold?: number;
  /** Visible-surface margin from the work-area edge when snapped. */
  margin?: number;
  /** Gutter size (defaults to SHADOW_INSET). */
  inset?: number;
}
export interface SnapResult {
  rect: Rect;
  edgeX: 'left' | 'right' | null;
  edgeY: 'top' | 'bottom' | null;
}

function snapAxis(
  pos: number,
  size: number,
  areaStart: number,
  areaSize: number,
  inset: number,
  margin: number,
  threshold: number,
): [number, 'start' | 'end' | null] {
  const visStart = pos + inset;
  const visSize = size - inset * 2;
  const toStart = areaStart + margin;
  const toEnd = areaStart + areaSize - margin - visSize;
  const dStart = Math.abs(visStart - toStart);
  const dEnd = Math.abs(visStart - toEnd);
  if (dStart <= threshold && dStart <= dEnd) return [toStart - inset, 'start'];
  if (dEnd <= threshold) return [toEnd - inset, 'end'];
  return [pos, null];
}

/** Snap the VISIBLE surface to the work-area edges (window coords in/out). */
export function snapRectToArea(rect: Rect, workArea: Rect, opts: SnapOptions = {}): SnapResult {
  const threshold = opts.threshold ?? 18;
  const margin = opts.margin ?? 12;
  const inset = opts.inset ?? SHADOW_INSET;
  const [x, sx] = snapAxis(rect.x, rect.width, workArea.x, workArea.width, inset, margin, threshold);
  const [y, sy] = snapAxis(rect.y, rect.height, workArea.y, workArea.height, inset, margin, threshold);
  return {
    rect: { ...rect, x, y },
    edgeX: sx === 'start' ? 'left' : sx === 'end' ? 'right' : null,
    edgeY: sy === 'start' ? 'top' : sy === 'end' ? 'bottom' : null,
  };
}

/* ------------------------------------------------------------------ */
/* Edge resize                                                         */
/* ------------------------------------------------------------------ */

/** Pure edge/corner resize with min/max, anchoring the opposite edge. */
export function resizeRectByEdge(
  start: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  min: Size,
  max: Size,
): Rect {
  let { x, y, width, height } = start;
  if (edge.includes('e')) width = clamp(start.width + dx, min.width, max.width);
  if (edge.includes('w')) {
    width = clamp(start.width - dx, min.width, max.width);
    x = start.x + start.width - width;
  }
  if (edge.includes('s')) height = clamp(start.height + dy, min.height, max.height);
  if (edge.includes('n')) {
    height = clamp(start.height - dy, min.height, max.height);
    y = start.y + start.height - height;
  }
  return { x, y, width, height };
}