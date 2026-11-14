import type { HudDisplayMode } from './types.js';

/**
 * Pure display-mode geometry for the desktop HUD window.
 *
 * The HUD is an always-on-top surface that collapses to a 74x74 orb and
 * expands to a full console. Every size and position decision lives here so
 * the rules can be tested without an Electron process, and so the renderer
 * and the main process agree on what the persisted mode means.
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

export const DISPLAY_PRESETS: Record<HudDisplayMode, Size> = {
  orb: { width: 74, height: 74 },
  bar: { width: 420, height: 62 },
  full: { width: 400, height: 600 },
  console: { width: 540, height: 700 },
};

export function isHudDisplayMode(value: unknown): value is HudDisplayMode {
  return value === 'orb' || value === 'bar' || value === 'full' || value === 'console';
}

/**
 * The display mode to launch with, given the persisted value.
 *
 * Only the full window (console/full) is a real launch state: the bar and the
 * orb are deliberate collapse actions, and restoring either on startup is what
 * made the floating window appear to vanish or open as a tiny strip. Launch
 * into the console (the main floating window) so the user always gets the full
 * interface first; collapsing stays one click away.
 */
export function resolveInitialDisplayMode(saved: unknown): HudDisplayMode {
  return saved === 'full' || saved === 'console' ? saved : 'console';
}

/** True when the rect lies entirely inside the work area. */
export function isRectFullyVisible(bounds: Rect, area: Rect): boolean {
  return (
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  );
}

/** True when the rect shares any pixel with the work area. */
export function isRectVisible(bounds: Rect, area: Rect): boolean {
  return (
    bounds.x + bounds.width > area.x &&
    bounds.x < area.x + area.width &&
    bounds.y + bounds.height > area.y &&
    bounds.y < area.y + area.height
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a rect into the work area, shrinking it when it is larger than the
 * display. Position is nudged only as far as necessary, which keeps an
 * on-screen window exactly where the user left it.
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

/**
 * Resize to `target` while keeping the right edge where it is, then clamp the
 * result inside the work area. The HUD grows leftwards from its corner so the
 * pointer and the user's focus stay in the same place.
 */
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
