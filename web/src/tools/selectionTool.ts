import { pointInPolygon, signedArea2, distance, type Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Lasso selection of pedestrians and generators, from
 * controller/SelectionToolMouseListener.
 *
 * Drag to enclose a group; the outline is built from the path the pointer takes,
 * so an irregular shape can be drawn around part of a crowd. A press and release
 * without dragging is a click, which picks the single pedestrian -- or the
 * generator -- underneath.
 *
 * Generators are selectable through the same gesture rather than a second one of
 * their own, because what you do next is identical: a door is picked in order to
 * be sent somewhere, exactly as a group of pedestrians is, and the goal tool that
 * follows does not care which it was handed.
 *
 * Holding shift adds to the current selection instead of replacing it, matching
 * the original's "extend mode".
 *
 * A gesture that ends with pedestrians selected hands over to the goal tool, the
 * step that always follows. One that catches nobody says so and keeps the tool
 * in hand instead.
 */
const DRAG_THRESHOLD = 5;
/** Don't record a lasso point for every pixel of pointer movement. */
const MIN_POINT_SPACING = 4;

export class SelectionTool implements Tool {
  readonly id = 'select' as const;
  readonly cursor = 'crosshair';

  private lasso: Point[] = [];
  private pressAt: Point | null = null;
  private dragging = false;

  onPointerDown(e: PointerInfo): void {
    if (e.buttons !== 1) return;
    this.pressAt = e.world;
    this.lasso = [e.world];
    this.dragging = false;
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    if (!this.pressAt || e.buttons === 0) return;
    if (!this.dragging && distance(this.pressAt, e.world) >= DRAG_THRESHOLD) {
      this.dragging = true;
    }
    if (!this.dragging) return;
    const last = this.lasso[this.lasso.length - 1];
    if (!last || distance(last, e.world) >= MIN_POINT_SPACING) {
      this.lasso.push(e.world);
      ctx.requestRender();
    }
  }

  onPointerUp(e: PointerInfo, ctx: ToolContext): void {
    const press = this.pressAt;
    this.pressAt = null;
    if (!press) return;

    const before = ctx.selectionCount();
    const wasDrag = this.dragging;
    if (wasDrag) {
      ctx.selectPedestriansIn(this.outline(press, e.world), e.shiftKey);
    } else {
      ctx.selectPedestrianAt(press, e.shiftKey);
    }
    this.lasso = [];
    this.dragging = false;
    ctx.requestRender();

    // Whether this gesture caught anyone -- not whether anything is selected.
    // Extending a selection over empty ground leaves the old one standing, so
    // the count alone would read as a hit.
    const caught = e.shiftKey ? ctx.selectionCount() > before : ctx.selectionCount() > 0;
    if (!caught) {
      // Walls, the background and the empty gaps in a crowd are not selectable,
      // and a gesture that lands on one looks exactly like a gesture that
      // failed. Say so, and stay in hand so the next try needs no toolbar trip.
      ctx.notify(wasDrag
        ? 'Nothing in there — the selection tool picks pedestrians and generators, not walls.'
        : 'Nothing to select there — the selection tool picks pedestrians and generators, not walls.');
      return;
    }

    // A group -- or a door -- is picked in order to be sent somewhere, so the
    // goal tool is what comes next; arming it here saves a trip back to the
    // toolbar. Not while shift is down -- that is extend mode, and the selection
    // is still being built.
    if (!e.shiftKey) ctx.activateTool('goal');
  }

  cancel(): void {
    this.lasso = [];
    this.pressAt = null;
    this.dragging = false;
  }

  preview(): ToolPreview {
    if (!this.dragging || !this.pressAt) return EMPTY_PREVIEW;
    const last = this.lasso[this.lasso.length - 1] ?? this.pressAt;
    return { ...EMPTY_PREVIEW, selectionPolygon: this.outline(this.pressAt, last) };
  }

  /**
   * The shape to select with.
   *
   * A slow, curved drag leaves enough points to use as a lasso. A quick straight
   * drag does not -- the pointer may only report a couple of positions, and those
   * enclose no area at all -- so it falls back to the rectangle between where the
   * drag began and where it ended. Without this a fast drag selects nothing,
   * which just reads as the tool being broken.
   */
  private outline(from: Point, to: Point): Point[] {
    if (this.lasso.length >= 3) {
      const bbox = boundingArea(this.lasso);
      const enclosed = Math.abs(signedArea2(this.lasso)) / 2;
      // A genuine lasso covers a decent share of its own bounding box; a straight
      // smear covers almost none of it.
      if (bbox > 0 && enclosed / bbox > 0.15) return this.lasso;
    }
    return [
      [from[0], from[1]],
      [to[0], from[1]],
      [to[0], to[1]],
      [from[0], to[1]],
    ];
  }
}

/** Whether a point falls inside a lasso outline. */
export function insideLasso(lasso: Point[], p: Point): boolean {
  return pointInPolygon(lasso, p);
}

function boundingArea(points: Point[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}
