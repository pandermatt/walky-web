import { rectanglePolygon } from '../state/model';
import { distance, type Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Rectangular wall, from controller/RectangleWallToolMouseListener.
 *
 * Accepts both gestures. The original was click-then-click-again; dragging is the
 * gesture most people reach for first, so a press-move-release that travels far
 * enough commits the rectangle directly, while a press and release in roughly the
 * same spot falls back to the original two-click mode.
 */
const DRAG_THRESHOLD = 6;

export class RectangleTool implements Tool {
  readonly id = 'rectangle' as const;
  readonly cursor = 'crosshair';

  /** First corner, once placed by a click. */
  private first: Point | null = null;
  /** Where the pointer went down, while it is still down. */
  private pressAt: Point | null = null;
  private mouse: Point | null = null;

  onPointerDown(e: PointerInfo): void {
    if (e.buttons !== 1) return;
    this.pressAt = snap(e.world);
    this.mouse = e.world;
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    ctx.requestRender();
  }

  onPointerUp(e: PointerInfo, ctx: ToolContext): void {
    const press = this.pressAt;
    this.pressAt = null;
    if (!press) return;
    const here = snap(e.world);

    if (distance(press, here) >= DRAG_THRESHOLD) {
      // Dragged: the press and release are the two corners.
      this.commit(press, here, ctx);
      return;
    }

    // Treated as a click: first sets a corner, second completes.
    if (!this.first) {
      this.first = press;
      ctx.requestRender();
      return;
    }
    this.commit(this.first, here, ctx);
  }

  cancel(): void {
    this.first = null;
    this.pressAt = null;
    this.mouse = null;
  }

  preview(): ToolPreview {
    const anchor = this.pressAt ?? this.first;
    if (anchor && this.mouse) {
      return { ...EMPTY_PREVIEW, pendingRect: [anchor, this.mouse] };
    }
    return {
      ...EMPTY_PREVIEW,
      cursorGhost: this.mouse ? { kind: 'square', at: this.mouse, size: 9 } : null,
    };
  }

  private commit(a: Point, b: Point, ctx: ToolContext): void {
    if (Math.abs(b[0] - a[0]) >= 1 && Math.abs(b[1] - a[1]) >= 1) {
      ctx.addWall(rectanglePolygon(a, b));
    }
    this.cancel();
    ctx.requestRender();
  }
}

function snap(p: Point): Point {
  return [Math.round(p[0]), Math.round(p[1])];
}
