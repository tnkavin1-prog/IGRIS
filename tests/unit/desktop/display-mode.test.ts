import { describe, it, expect } from 'vitest';
import {
  DISPLAY_PRESETS,
  clampRectIntoArea,
  isHudDisplayMode,
  isRectFullyVisible,
  isRectVisible,
  resizePreservingRightEdge,
  resolveInitialDisplayMode,
} from '../../../apps/desktop-hud/src/main/display-mode.js';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

describe('resolveInitialDisplayMode', () => {
  it('never launches into the orb', () => {
    // The orb is a deliberate collapse action; restoring it at startup is
    // what made the floating window appear to vanish.
    expect(resolveInitialDisplayMode('orb')).toBe('console');
  });

  it('never launches into the bar either', () => {
    // The bar is a collapsed state too. The main floating window must be the
    // primary launch surface, so a saved bar does not survive a restart.
    expect(resolveInitialDisplayMode('bar')).toBe('console');
  });

  it('restores the full window modes', () => {
    expect(resolveInitialDisplayMode('full')).toBe('full');
    expect(resolveInitialDisplayMode('console')).toBe('console');
  });

  it('falls back to the console for missing or corrupt values', () => {
    expect(resolveInitialDisplayMode(null)).toBe('console');
    expect(resolveInitialDisplayMode(undefined)).toBe('console');
    expect(resolveInitialDisplayMode('')).toBe('console');
    expect(resolveInitialDisplayMode('nonsense')).toBe('console');
    expect(resolveInitialDisplayMode(42)).toBe('console');
  });
});

describe('isHudDisplayMode', () => {
  it('accepts exactly the four modes', () => {
    for (const mode of ['orb', 'bar', 'full', 'console']) {
      expect(isHudDisplayMode(mode)).toBe(true);
    }
    expect(isHudDisplayMode('ORB')).toBe(false);
    expect(isHudDisplayMode(null)).toBe(false);
    expect(isHudDisplayMode({ mode: 'orb' })).toBe(false);
  });
});

describe('visibility predicates', () => {
  it('treats a rect inside the work area as fully visible', () => {
    expect(isRectFullyVisible({ x: 100, y: 100, width: 420, height: 62 }, AREA)).toBe(true);
  });

  it('treats a rect hanging off any edge as not fully visible', () => {
    expect(isRectFullyVisible({ x: -10, y: 100, width: 420, height: 62 }, AREA)).toBe(false);
    expect(isRectFullyVisible({ x: 1800, y: 100, width: 420, height: 62 }, AREA)).toBe(false);
    expect(isRectFullyVisible({ x: 100, y: -10, width: 420, height: 62 }, AREA)).toBe(false);
    expect(isRectFullyVisible({ x: 100, y: 1020, width: 420, height: 62 }, AREA)).toBe(false);
  });

  it('distinguishes partially visible from fully invisible', () => {
    expect(isRectVisible({ x: 1800, y: 100, width: 420, height: 62 }, AREA)).toBe(true);
    expect(isRectVisible({ x: 2000, y: 100, width: 420, height: 62 }, AREA)).toBe(false);
    expect(isRectVisible({ x: 100, y: -100, width: 420, height: 62 }, AREA)).toBe(false);
  });
});

describe('clampRectIntoArea', () => {
  it('leaves an on-screen rect exactly where it is', () => {
    const bounds = { x: 100, y: 100, width: 420, height: 62 };
    expect(clampRectIntoArea(bounds, AREA, 40)).toEqual(bounds);
  });

  it('pulls a window stranded at negative coordinates back on screen', () => {
    const next = clampRectIntoArea({ x: -900, y: -300, width: 420, height: 62 }, AREA, 40);
    expect(next.x).toBe(40);
    expect(next.y).toBe(40);
  });

  it('pulls a window stranded past the right and bottom edges back on screen', () => {
    const next = clampRectIntoArea({ x: 4000, y: 3000, width: 420, height: 62 }, AREA, 40);
    expect(next.x + next.width).toBe(AREA.width - 40);
    expect(next.y + next.height).toBe(AREA.height - 40);
  });

  it('shrinks a rect larger than the work area', () => {
    const next = clampRectIntoArea({ x: 0, y: 0, width: 4000, height: 3000 }, AREA, 0);
    expect(next.width).toBe(AREA.width);
    expect(next.height).toBe(AREA.height);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('handles a monitor placed at negative coordinates', () => {
    const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1040 };
    const next = clampRectIntoArea({ x: -3000, y: 100, width: 420, height: 62 }, leftMonitor, 20);
    expect(next.x).toBe(-1920 + 20);
    expect(next.y).toBe(100);
  });
});

describe('resizePreservingRightEdge', () => {
  it('keeps the right edge anchored while growing', () => {
    const current = { x: 1400, y: 300, width: 420, height: 62 };
    const next = resizePreservingRightEdge(current, DISPLAY_PRESETS.console, AREA);
    expect(next.width).toBe(540);
    expect(next.height).toBe(700);
    expect(next.x + next.width).toBe(current.x + current.width);
    expect(next.y).toBe(current.y);
  });

  it('keeps the right edge anchored while shrinking to the orb', () => {
    const current = { x: 1400, y: 300, width: 420, height: 62 };
    const next = resizePreservingRightEdge(current, DISPLAY_PRESETS.orb, AREA);
    expect(next.width).toBe(74);
    expect(next.height).toBe(74);
    expect(next.x + next.width).toBe(current.x + current.width);
  });

  it('clamps the left edge when the HUD sits near the left of the display', () => {
    const current = { x: 10, y: 10, width: 420, height: 62 };
    const next = resizePreservingRightEdge(current, DISPLAY_PRESETS.console, AREA);
    expect(next.x).toBe(AREA.x);
    expect(next.x + next.width).toBeLessThanOrEqual(AREA.x + AREA.width);
  });

  it('clamps the bottom edge when the HUD sits low on the display', () => {
    const current = { x: 1400, y: 1000, width: 420, height: 62 };
    const next = resizePreservingRightEdge(current, DISPLAY_PRESETS.console, AREA);
    expect(next.y + next.height).toBeLessThanOrEqual(AREA.y + AREA.height);
  });

  it('shrinks the target when it does not fit the work area', () => {
    const small = { x: 0, y: 0, width: 800, height: 600 };
    const next = resizePreservingRightEdge(
      { x: 0, y: 0, width: 100, height: 60 },
      {
        width: 1200,
        height: 900,
      },
      small,
    );
    expect(next.width).toBe(small.width);
    expect(next.height).toBe(small.height);
  });
});
