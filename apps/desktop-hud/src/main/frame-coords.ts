/**
 * FrameCoordinateMapper — converts model-reported image coordinates into
 * physical desktop coordinates.
 *
 * Gemini Live receives downscaled JPEG frames (typically 1024×576) while the
 * native mouse APIs operate in *physical* desktop pixels. On a 125 % scaled
 * display a frame pixel is therefore worth ~2.35 desktop pixels, so feeding
 * model coordinates straight into `mouseClick` lands the cursor in the wrong
 * place. This mapper records the geometry of the most recent full-screen frame
 * and rescales coordinates proportionally.
 *
 * Safety rules:
 *  - No recorded frame (or a stale one) → coordinates pass through unchanged,
 *    preserving behaviour for callers that already work in physical pixels.
 *  - A coordinate outside the frame bounds is assumed to already be physical
 *    and passes through unchanged (models occasionally report desktop pixels).
 *  - Results are clamped to the captured display so a bad coordinate cannot
 *    move the cursor onto another monitor unexpectedly.
 */

export interface FrameGeometry {
  /** Width of the JPEG frame that was sent to the model. */
  imageWidth: number;
  /** Height of the JPEG frame that was sent to the model. */
  imageHeight: number;
  /** Physical desktop bounds represented by that frame. */
  displayBounds: { x: number; y: number; width: number; height: number };
}

export interface MappedPoint {
  x: number;
  y: number;
  /** True when the point was rescaled from frame space. */
  scaled: boolean;
}

/** Frames older than this are ignored so stale geometry cannot misdirect clicks. */
const MAX_FRAME_AGE_MS = 15_000;

export class FrameCoordinateMapper {
  private frame: FrameGeometry | null = null;
  private recordedAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Record the geometry of a freshly captured full-screen frame. */
  public recordFrame(geometry: FrameGeometry): void {
    if (
      !Number.isFinite(geometry.imageWidth) ||
      !Number.isFinite(geometry.imageHeight) ||
      geometry.imageWidth <= 0 ||
      geometry.imageHeight <= 0 ||
      geometry.displayBounds.width <= 0 ||
      geometry.displayBounds.height <= 0
    ) {
      return;
    }
    this.frame = { ...geometry };
    this.recordedAt = this.now();
  }

  /** Forget the current frame (e.g. after a window-only capture). */
  public clear(): void {
    this.frame = null;
    this.recordedAt = 0;
  }

  public getFrame(): FrameGeometry | null {
    if (!this.frame) return null;
    return this.now() - this.recordedAt <= MAX_FRAME_AGE_MS ? this.frame : null;
  }

  /**
   * Map a model-supplied point to physical desktop pixels.
   * Pass `space: 'physical'` when the caller already knows the units.
   */
  public toPhysical(
    x: number,
    y: number,
    options: { space?: 'frame' | 'physical' } = {},
  ): MappedPoint {
    const rawX = Number(x);
    const rawY = Number(y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      return { x: 0, y: 0, scaled: false };
    }

    const frame = this.getFrame();
    if (!frame || options.space === 'physical') {
      return { x: Math.round(rawX), y: Math.round(rawY), scaled: false };
    }

    // Coordinates larger than the frame cannot be frame pixels.
    if (rawX > frame.imageWidth || rawY > frame.imageHeight || rawX < 0 || rawY < 0) {
      return { x: Math.round(rawX), y: Math.round(rawY), scaled: false };
    }

    const scaleX = frame.displayBounds.width / frame.imageWidth;
    const scaleY = frame.displayBounds.height / frame.imageHeight;
    let mappedX = frame.displayBounds.x + rawX * scaleX;
    let mappedY = frame.displayBounds.y + rawY * scaleY;

    // Keep the cursor inside the captured display.
    const minX = frame.displayBounds.x;
    const minY = frame.displayBounds.y;
    const maxX = frame.displayBounds.x + frame.displayBounds.width - 1;
    const maxY = frame.displayBounds.y + frame.displayBounds.height - 1;
    mappedX = Math.min(maxX, Math.max(minX, mappedX));
    mappedY = Math.min(maxY, Math.max(minY, mappedY));

    return { x: Math.round(mappedX), y: Math.round(mappedY), scaled: true };
  }
}
