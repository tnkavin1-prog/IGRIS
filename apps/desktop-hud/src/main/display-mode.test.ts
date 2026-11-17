import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LIMITS,
  SHADOW_INSET,
  anchorFor,
  clampRectIntoArea,
  consoleWindowLimits,
  inflateRect,
  recoverRect,
  resizeAnchored,
  resizeRectByEdge,
  resolveInitialDisplayMode,
  snapRectToArea,
  windowSizeFor,
} from './display-mode.js';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const G = SHADOW_INSET * 2;

describe('windowSizeFor', () => {
  it('adds the shadow gutter to presets', () => {
    expect(windowSizeFor('orb')).toEqual({ width: 74 + G, height: 74 + G });
    expect(windowSizeFor('full')).toEqual({ width: 400 + G, height: 600 + G });
  });
  it('clamps a saved console size into limits', () => {
    const { min, max } = consoleWindowLimits();
    expect(windowSizeFor('console', { width: 10, height: 10 })).toEqual(min);
    expect(windowSizeFor('console', { width: 9999, height: 9999 })).toEqual(max);
    expect(min.width).toBe(CONSOLE_LIMITS.min.width + G);
  });
});

describe('resolveInitialDisplayMode', () => {
  it('never launches collapsed', () => {
    expect(resolveInitialDisplayMode('orb')).toBe('full');
    expect(resolveInitialDisplayMode('bar')).toBe('full');
    expect(resolveInitialDisplayMode('console')).toBe('full');
    expect(resolveInitialDisplayMode(undefined)).toBe('full');
  });
});

describe('anchoring', () => {
  it('shrinks toward the nearest corner', () => {
    const br = { x: 1500, y: 700, width: 400, height: 300 };
    expect(anchorFor(br, AREA)).toEqual({ x: 'right', y: 'bottom' });
    expect(resizeAnchored(br, { width: 100, height: 100 }, AREA)).toEqual({
      x: 1800,
      y: 900,
      width: 100,
      height: 100,
    });
    const tl = { x: 100, y: 100, width: 400, height: 300 };
    expect(resizeAnchored(tl, { width: 100, height: 100 }, AREA)).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
  });
  it('clamps growth that would leave the display', () => {
    const r = resizeAnchored({ x: 1850, y: 10, width: 74, height: 74 }, { width: 400, height: 600 }, AREA);
    expect(r.x + r.width).toBeLessThanOrEqual(AREA.width);
  });
});

describe('snapRectToArea', () => {
  const size = 100 + G;
  it('snaps visible surface to the left margin', () => {
    const r = snapRectToArea({ x: 0, y: 500, width: size, height: size }, AREA);
    expect(r.edgeX).toBe('left');
    expect(r.rect.x).toBe(12 - SHADOW_INSET);
    expect(r.edgeY).toBeNull();
  });
  it('snaps to the right margin', () => {
    const r = snapRectToArea({ x: 1800, y: 500, width: size, height: size }, AREA);
    expect(r.edgeX).toBe('right');
    expect(r.rect.x).toBe(1920 - 12 - 100 - SHADOW_INSET);
  });
  it('leaves mid-screen positions alone', () => {
    const r = snapRectToArea({ x: 400, y: 400, width: size, height: size }, AREA);
    expect(r.rect.x).toBe(400);
    expect(r.edgeX).toBeNull();
  });
});

describe('resizeRectByEdge', () => {
  const start = { x: 100, y: 100, width: 500, height: 500 };
  const min = { width: 380, height: 480 };
  const max = { width: 960, height: 1000 };
  it('west edge keeps the right edge fixed', () => {
    expect(resizeRectByEdge(start, 'w', -50, 0, min, max)).toMatchObject({ x: 50, width: 550 });
  });
  it('respects min and keeps the opposite edge', () => {
    const r = resizeRectByEdge(start, 'w', 500, 0, min, max);
    expect(r.width).toBe(380);
    expect(r.x + r.width).toBe(600);
  });
  it('respects max on corners', () => {
    const r = resizeRectByEdge(start, 'se', 5000, 5000, min, max);
    expect(r).toMatchObject({ width: 960, height: 1000 });
  });
});

describe('recoverRect (monitor changes)', () => {
  const rect = { x: 2500, y: 100, width: 400, height: 600 };
  it('pulls a window from a vanished monitor back on-screen', () => {
    const r = recoverRect(rect, [AREA]);
    expect(r.x).toBe(AREA.width + SHADOW_INSET - rect.width);
    expect(r.y).toBe(100);
  });
  it('does not move a visible window', () => {
    const ok = { x: 300, y: 200, width: 400, height: 600 };
    expect(recoverRect(ok, [AREA])).toBe(ok);
  });
  it('resolves straddling two displays to the dominant one', () => {
    const areas = [AREA, { x: 1920, y: 0, width: 1920, height: 1040 }];
    const r = recoverRect({ x: 1800, y: 100, width: 400, height: 300 }, areas);
    expect(r.x).toBe(1920 - SHADOW_INSET);
  });
  it('no displays => unchanged', () => {
    expect(recoverRect(rect, [])).toBe(rect);
  });
});

describe('clampRectIntoArea', () => {
  it('shrinks oversize rects', () => {
    const r = clampRectIntoArea({ x: 0, y: 0, width: 5000, height: 5000 }, AREA);
    expect(r).toMatchObject({ width: 1920, height: 1040 });
  });
  it('works with inflated areas', () => {
    const r = clampRectIntoArea({ x: -100, y: 0, width: 100, height: 100 }, inflateRect(AREA, 16));
    expect(r.x).toBe(-16);
  });
});