import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isHudDisplayMode, type Size } from './display-mode.js';
import type { HudDisplayMode } from './types.js';

export interface SavedPoint {
  x: number;
  y: number;
}

export interface WindowState {
  version: 1;
  mode: HudDisplayMode;
  pinned: boolean;
  /** Console WINDOW size (gutter included). */
  consoleSize?: Size;
  /** Last position the USER dragged each mode to (window coordinates). */
  positions: Partial<Record<HudDisplayMode, SavedPoint>>;
}

const MODES: HudDisplayMode[] = ['orb', 'bar', 'full', 'console', 'advanced'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function defaultWindowState(): WindowState {
  return { version: 1, mode: 'full', pinned: true, positions: {} };
}

/** Pure + defensive: a corrupt file must never brick the HUD. */
export function parseWindowState(raw: unknown): WindowState {
  const out = defaultWindowState();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (isHudDisplayMode(o.mode)) out.mode = o.mode;
  if (typeof o.pinned === 'boolean') out.pinned = o.pinned;
  const cs = o.consoleSize as Record<string, unknown> | undefined;
  if (cs && isNum(cs.width) && isNum(cs.height) && cs.width > 0 && cs.height > 0) {
    out.consoleSize = { width: cs.width, height: cs.height };
  }
  const pos = o.positions as Record<string, unknown> | undefined;
  if (pos && typeof pos === 'object') {
    for (const m of MODES) {
      const p = pos[m] as Record<string, unknown> | undefined;
      if (p && isNum(p.x) && isNum(p.y)) out.positions[m] = { x: p.x, y: p.y };
    }
  }
  return out;
}

const file = () => join(app.getPath('userData'), 'hud-window-state.json');

export function loadWindowState(): WindowState {
  try {
    return parseWindowState(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    return defaultWindowState();
  }
}

let pending: WindowState | null = null;
let timer: NodeJS.Timeout | undefined;

export function saveWindowStateSoon(state: WindowState, delayMs = 400): void {
  pending = state;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushWindowState, delayMs);
}

/** Atomic write (tmp + rename). Safe to call from before-quit. */
export function flushWindowState(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!pending) return;
  const state = pending;
  pending = null;
  try {
    const target = file();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, target);
  } catch {
    /* non-fatal */
  }
}
