import { describe, expect, it } from 'vitest';
import { FrameCoordinateMapper } from '../../../apps/desktop-hud/src/main/frame-coords.js';

const frame = {
  imageWidth: 1024,
  imageHeight: 576,
  displayBounds: { x: 0, y: 0, width: 2400, height: 1350 },
};

describe('FrameCoordinateMapper', () => {
  it('passes coordinates through when no frame has been recorded', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    expect(mapper.toPhysical(100, 200)).toEqual({ x: 100, y: 200, scaled: false });
  });

  it('scales frame pixels to the physical display', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame(frame);

    // 512/1024 of 2400 = 1200; 288/576 of 1350 = 675
    expect(mapper.toPhysical(512, 288)).toEqual({ x: 1200, y: 675, scaled: true });
  });

  it('accounts for a display origin other than (0, 0)', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame({ ...frame, displayBounds: { x: 1920, y: 0, width: 2560, height: 1440 } });

    // Left edge of the secondary monitor.
    expect(mapper.toPhysical(0, 0)).toEqual({ x: 1920, y: 0, scaled: true });
    // Halfway across: 1920 + 1280 = 3200
    expect(mapper.toPhysical(512, 288)).toEqual({ x: 3200, y: 720, scaled: true });
  });

  it('passes through values that cannot be frame pixels', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame(frame);
    expect(mapper.toPhysical(2200, 900)).toEqual({ x: 2200, y: 900, scaled: false });
  });

  it('honours an explicit physical coordinate space', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame(frame);
    expect(mapper.toPhysical(512, 288, { space: 'physical' })).toEqual({
      x: 512,
      y: 288,
      scaled: false,
    });
  });

  it('clamps mapped points inside the captured display', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame(frame);
    const point = mapper.toPhysical(1024, 576);
    expect(point.x).toBeLessThanOrEqual(2399);
    expect(point.y).toBeLessThanOrEqual(1349);
  });

  it('ignores stale frames', () => {
    let now = 1_000;
    const mapper = new FrameCoordinateMapper(() => now);
    mapper.recordFrame(frame);
    now += 60_000;
    expect(mapper.getFrame()).toBeNull();
    expect(mapper.toPhysical(512, 288).scaled).toBe(false);
  });

  it('clears the recorded frame on demand', () => {
    const mapper = new FrameCoordinateMapper(() => 1_000);
    mapper.recordFrame(frame);
    mapper.clear();
    expect(mapper.getFrame()).toBeNull();
  });
});
