import { describe, it, expect, beforeEach } from 'vitest';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import type { DisplayMetrics } from '../../../apps/desktop-hud/src/main/types.js';

describe('Per-Monitor DPI-Aware Coordinate Mapping', () => {
  let input: NativeInputService;

  const mockMultiDisplayMetrics: DisplayMetrics = {
    primaryDisplay: {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.0,
      isPrimary: true,
    },
    allDisplays: [
      {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.0,
        isPrimary: true,
      },
      {
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
        scaleFactor: 1.5,
        isPrimary: false,
      },
      {
        id: 3,
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.25,
        isPrimary: false,
      },
    ],
  };

  beforeEach(() => {
    input = new NativeInputService({
      mockMode: true,
      displayMetrics: mockMultiDisplayMetrics,
    });
  });

  it('leaves coordinates unscaled when scaleWithDpi is false or omitted', () => {
    const coords1 = input.mapCoordinates(100.4, 200.6);
    expect(coords1).toEqual({ x: 100, y: 201 });

    const coords2 = input.mapCoordinates(2120, 300, { scaleWithDpi: false });
    expect(coords2).toEqual({ x: 2120, y: 300 });
  });

  it('leaves primary monitor coordinates unscaled at 1.0 scale factor', () => {
    const coords = input.mapCoordinates(960, 540, { scaleWithDpi: true });
    expect(coords).toEqual({ x: 960, y: 540 });
  });

  it('scales secondary 1.5x monitor coordinates relative to monitor origin', () => {
    // Coordinate on Monitor 2 (x=1920..4480, scale=1.5)
    // Offset from monitor 2 origin (1920, 0): (200, 100) -> scaled: (300, 150)
    // Physical coordinates: (1920 + 300, 0 + 150) = (2220, 150)
    const physical = input.mapCoordinates(2120, 100, { scaleWithDpi: true });
    expect(physical).toEqual({ x: 2220, y: 150 });

    // Using toPhysical helper
    const viaHelper = input.toPhysical(2120, 100);
    expect(viaHelper).toEqual({ x: 2220, y: 150 });
  });

  it('scales negative-offset monitor coordinates at 1.25x scale factor', () => {
    // Monitor 3: bounds { x: -1920, y: 0, width: 1920, height: 1080 }, scale = 1.25
    // Coordinate inside monitor 3: (-1000, 200)
    // relX = -1000 - (-1920) = 920.
    // 920 * 1.25 = 1150.
    // physX = -1920 + 1150 = -770.
    // relY = 200 - 0 = 200.
    // 200 * 1.25 = 250.
    // physY = 0 + 250 = 250.
    const physical = input.toPhysical(-1000, 200);
    expect(physical).toEqual({ x: -770, y: 250 });
  });

  it('allows explicit monitor targeting via monitorId option', () => {
    // Force target monitor 2 even with arbitrary coordinate
    const physical = input.mapCoordinates(100, 100, { scaleWithDpi: true, monitorId: 2 });
    // bounds.x = 1920, relX = 100 - 1920 = -1820 -> -1820 * 1.5 = -2730 -> 1920 - 2730 = -810
    expect(physical.x).toBe(1920 + Math.round((100 - 1920) * 1.5));
  });

  it('performs inverse toLogical mapping from physical screen pixels back to logical layout', () => {
    // Physical coordinate on monitor 2: (2220, 150)
    const logical = input.toLogical(2220, 150);
    expect(logical).toEqual({ x: 2120, y: 100 });

    // Physical coordinate on monitor 1 (1.0x): (960, 540)
    const logicalPrimary = input.toLogical(960, 540);
    expect(logicalPrimary).toEqual({ x: 960, y: 540 });
  });

  it('mouseMove, mouseClick, and mouseDrag pass scaled coordinates to action history and cursor', async () => {
    // mouseMove with DPI scaling
    await input.mouseMove(2120, 100, { scaleWithDpi: true });
    const cursor = await input.getCursorPosition();
    expect(cursor).toEqual({ x: 2220, y: 150 });

    const moveAction = input.getLastAction();
    expect(moveAction?.type).toBe('move');
    expect(moveAction?.x).toBe(2220);
    expect(moveAction?.y).toBe(150);

    // mouseClick with DPI scaling
    await input.mouseClick(2120, 100, { button: 'left', scaleWithDpi: true });
    const clickAction = input.getLastAction();
    expect(clickAction?.type).toBe('click');
    expect(clickAction?.x).toBe(2220);
    expect(clickAction?.y).toBe(150);

    // mouseDrag with DPI scaling
    await input.mouseDrag(100, 100, 2120, 100, 5, { scaleWithDpi: true });
    const dragAction = input.getLastAction();
    expect(dragAction?.type).toBe('drag');
    expect(dragAction?.x).toBe(2220);
    expect(dragAction?.y).toBe(150);
  });

  it('toLogical does not misidentify primary monitor coordinates as negative-origin monitor coordinates', () => {
    // Coordinate (200, 200) is on the primary monitor.
    // It should not cross into Monitor 3 (bounds.x = -1920)
    const logical = input.toLogical(200, 200);
    expect(logical).toEqual({ x: 200, y: 200 });
  });

  it('supports explicit physicalBounds on displays for precise multi-monitor hardware alignment', () => {
    const customMetrics: DisplayMetrics = {
      width: 1920,
      height: 1080,
      scaleFactor: 1.0,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      allDisplays: [
        {
          id: 10,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          physicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1.0,
          isPrimary: true,
        },
        {
          id: 20,
          bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
          physicalBounds: { x: -2400, y: 0, width: 2400, height: 1350 },
          scaleFactor: 1.25,
          isPrimary: false,
        },
      ],
    };

    const customInput = new NativeInputService({
      mockMode: true,
      displayMetrics: customMetrics,
    });

    // Middle of negative monitor 20 in logical units: (-960, 540)
    // relX = -960 - (-1920) = 960 -> 960 * 1.25 = 1200
    // physicalX = -2400 + 1200 = -1200
    const phys = customInput.toPhysical(-960, 540);
    expect(phys).toEqual({ x: -1200, y: 675 });

    // Inverse toLogical
    const backToLogical = customInput.toLogical(-1200, 675);
    expect(backToLogical).toEqual({ x: -960, y: 540 });
  });
});
