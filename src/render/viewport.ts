import type { Point } from '../sim/geometry';

/**
 * Camera, ported from gui/ZoomMouseListener.
 *
 * The original tracked an integer zoom *level* and multiplied the AffineTransform
 * by 1.1 per wheel notch, clamping to 50 steps in and 20 steps out. Keeping the
 * level as the source of truth (rather than a free-floating scale) reproduces the
 * original's exact zoom stops and makes reset-zoom a single assignment.
 */
export const ZOOM_FACTOR = 1.1;
export const ZOOM_LEVEL_MIN = -50; // most zoomed in
export const ZOOM_LEVEL_MAX = 20;  // most zoomed out

export class Viewport {
  targetX = 0;
  targetY = 0;
  /** Matches ZoomMouseListener.startZoom: higher means further out. */
  zoomLevel = 0;
  width = 1;
  height = 1;

  get scale(): number {
    return Math.pow(ZOOM_FACTOR, -this.zoomLevel);
  }

  /** deck.gl expresses zoom as log2 of the scale. */
  toViewState(): { target: [number, number, number]; zoom: number } {
    return { target: [this.targetX, this.targetY, 0], zoom: Math.log2(this.scale) };
  }

  worldToScreen(p: Point): Point {
    const s = this.scale;
    return [
      this.width / 2 + (p[0] - this.targetX) * s,
      this.height / 2 + (p[1] - this.targetY) * s,
    ];
  }

  screenToWorld(p: Point): Point {
    const s = this.scale;
    return [
      (p[0] - this.width / 2) / s + this.targetX,
      (p[1] - this.height / 2) / s + this.targetY,
    ];
  }

  /** Zoom by whole notches, keeping the world point under the cursor fixed. */
  zoomAt(screen: Point, notches: number): void {
    this.zoomAbout(screen, this.zoomLevel + notches);
  }

  /**
   * Zoom by a scale ratio -- what a pinch measures -- about a screen point.
   *
   * Fingers have no detents, so this lands between the original's stops where
   * the wheel never could. Those stops are ZoomMouseListener's, and
   * ZoomMouseListener had a wheel and no fingers to be faithful to; the level
   * stays the source of truth either way, it simply stops being a whole number.
   */
  zoomByRatio(screen: Point, ratio: number): void {
    if (!(ratio > 0) || !Number.isFinite(ratio)) return;
    this.zoomAbout(screen, this.zoomLevel - Math.log(ratio) / Math.log(ZOOM_FACTOR));
  }

  /** Move to a zoom level with one screen point left over the same world point. */
  private zoomAbout(screen: Point, level: number): void {
    const before = this.screenToWorld(screen);
    this.zoomLevel = Math.max(ZOOM_LEVEL_MIN, Math.min(ZOOM_LEVEL_MAX, level));
    const after = this.screenToWorld(screen);
    this.targetX += before[0] - after[0];
    this.targetY += before[1] - after[1];
  }

  /** Drag the view by a screen-space delta. */
  panBy(dxScreen: number, dyScreen: number): void {
    const s = this.scale;
    this.targetX -= dxScreen / s;
    this.targetY -= dyScreen / s;
  }

  fit(bounds: { minX: number; minY: number; maxX: number; maxY: number }, margin = 60): void {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const wanted = Math.min(
      Math.max(1, this.width - margin * 2) / w,
      Math.max(1, this.height - margin * 2) / h,
    );
    // Snap to the nearest whole zoom notch so the camera stays on the original's stops.
    const level = Math.round(-Math.log(wanted) / Math.log(ZOOM_FACTOR));
    this.zoomLevel = Math.max(ZOOM_LEVEL_MIN, Math.min(ZOOM_LEVEL_MAX, level));
    this.targetX = (bounds.minX + bounds.maxX) / 2;
    this.targetY = (bounds.minY + bounds.maxY) / 2;
  }

  reset(): void {
    this.zoomLevel = 0;
  }
}
