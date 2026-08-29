import { distance, type Point } from '../sim/geometry';
import { simplifyClosed } from '../sim/simplify';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Freehand polygon wall, from controller/WallToolMouseListener.
 *
 * Two gestures, as the rectangle tool has two:
 *
 *  - Drag to trace a shape. Points are sampled along the pointer's path and the
 *    outline closes when the button is released.
 *  - Click to place individual vertices, double-click to close. This is the
 *    original's gesture, and it is what you want for a deliberate straight-edged
 *    shape.
 *
 * A traced stroke is simplified before it becomes a wall. Sampling produces a
 * point every few pixels -- hundreds for one shape -- and each would be a polygon
 * vertex. Vertex count drives the whole navigation pipeline: the split into
 * convex parts, and the O(n^2) visibility sweep over the resulting corners.
 * Simplifying first keeps the shape while cutting that cost by an order of
 * magnitude.
 */

/** Minimum gap between placed vertices in click mode, in world units. */
const MINIMUM_DISTANCE = 10;
/** Sampling gap while tracing, in screen pixels. */
const SAMPLE_SPACING_PX = 3;
/** How far the simplified outline may stray from the traced one, in screen pixels. */
const SIMPLIFY_TOLERANCE_PX = 2.5;
/** Past this, a press-and-release counts as a trace rather than a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Shapes from this tool are hulled on their own, never as part of a group.
 *
 * The dashed outline is drawn per connected group of touching shapes, which reads
 * well for the shapes a hull describes -- a rectangle, a frame, a blocky building.
 * What this tool makes is a freehand outline: an S, a spiral, a room traced by
 * hand. Letting one into a group's hull drags every wall it touches into a blob
 * that follows wherever the trace wandered, so it stays out of that shared
 * outline and gets one of its own instead -- its own convex hull, around its own
 * shape. See Wall.sharesOutline.
 */
const OWN_OUTLINE = { sharesOutline: false } as const;

export class WallTool implements Tool {
  readonly id = 'wall' as const;
  readonly cursor = 'crosshair';

  /** Vertices placed by clicking. */
  private points: Point[] = [];
  /** Raw samples of the current trace. */
  private stroke: Point[] = [];
  private pressAt: Point | null = null;
  private tracing = false;
  private mouse: Point | null = null;

  onPointerDown(e: PointerInfo): void {
    if (e.buttons !== 1) return;
    this.pressAt = e.world;
    this.stroke = [e.world];
    this.tracing = false;
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    if (this.pressAt && e.buttons !== 0) {
      const perPixel = ctx.worldPerPixel();
      if (!this.tracing && distance(this.pressAt, e.world) >= DRAG_THRESHOLD_PX * perPixel) {
        this.tracing = true;
      }
      if (this.tracing) {
        const last = this.stroke[this.stroke.length - 1];
        if (!last || distance(last, e.world) >= SAMPLE_SPACING_PX * perPixel) {
          this.stroke.push(e.world);
        }
      }
    }
    ctx.requestRender();
  }

  onPointerUp(e: PointerInfo, ctx: ToolContext): void {
    const press = this.pressAt;
    this.pressAt = null;
    if (!press) return;

    if (this.tracing) {
      this.commitTrace(ctx);
      return;
    }

    // Not a drag: place a vertex, as the original's click mode did.
    this.stroke = [];
    this.addPoint(e.world, false);
    ctx.requestRender();
  }

  onDoubleClick(e: PointerInfo, ctx: ToolContext): void {
    this.addPoint(e.world, true);
    if (this.points.length >= 3) ctx.addWall(this.points, OWN_OUTLINE);
    this.cancel();
    ctx.requestRender();
  }

  cancel(): void {
    this.points = [];
    this.stroke = [];
    this.pressAt = null;
    this.tracing = false;
  }

  preview(): ToolPreview {
    // While tracing, show the raw stroke; the reduction happens on release.
    const pending = this.tracing && this.stroke.length > 1 ? this.stroke : this.points;
    return {
      ...EMPTY_PREVIEW,
      pendingWallPoints: pending,
      pendingWallTracing: this.tracing,
      cursorGhost: this.mouse && !this.tracing
        ? { kind: 'squiggle', at: this.mouse, size: 14 }
        : null,
    };
  }

  private commitTrace(ctx: ToolContext): void {
    const tolerance = SIMPLIFY_TOLERANCE_PX * ctx.worldPerPixel();
    const simplified = simplifyClosed(this.stroke, tolerance)
      .map((p) => [Math.round(p[0]), Math.round(p[1])] as Point);
    if (simplified.length >= 3) ctx.addWall(simplified, OWN_OUTLINE);
    this.cancel();
    ctx.requestRender();
  }

  private addPoint(p: Point, force: boolean): void {
    const last = this.points[this.points.length - 1];
    if (!force && last && distance(last, p) < MINIMUM_DISTANCE) return;
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    this.points.push([Math.round(p[0]), Math.round(p[1])]);
  }
}
