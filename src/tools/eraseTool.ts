import type { Point } from '../sim/geometry';
import {
  EMPTY_PREVIEW,
  type EraseTarget, type PointerInfo, type Tool, type ToolContext, type ToolPreview,
} from './types';

/**
 * Rubs whole objects off the map: one drawn shape, one border frame, one
 * pedestrian. Never part of one -- a shape is what a single draw action made,
 * and that is the unit you can point at and mean.
 *
 * Shapes drawn against each other share a dashed outline (see groupWalls), but
 * that outline is a picture of what touches what, not an object. Erasing the
 * whole group would delete things you never pointed at, so a click takes the
 * one wall under it and leaves its neighbours standing.
 *
 * It sweeps. A press erases what is beneath it and dragging goes on erasing
 * what it passes over, which is what an eraser does and what clearing a corner
 * of a map wants; the whole stroke is one step to take back. There is no
 * interpolation between moves -- a shape big enough to click is wider than the
 * gap between two pointer events at any sane speed.
 *
 * Unlike the goal tool it stays armed after a hit. Erasing is a thing you do
 * several times in a row; stepping off after each shape would make clearing
 * three of them three trips back to the toolbar. Escape puts it down.
 */
export class EraseTool implements Tool {
  readonly id = 'erase' as const;
  readonly cursor = 'crosshair';
  /** What the pointer is over, outlined so it is clear what a click would take. */
  private target: EraseTarget | null = null;
  private mouse: Point | null = null;
  private erasing = false;
  /**
   * Whether this stroke has already taken something. It is what tells the app
   * to keep one undo step for the sweep -- and it is set by the first *removal*
   * rather than by the press, so a drag that starts on empty ground still
   * checkpoints when it finally reaches something.
   */
  private erasedThisStroke = false;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    this.erasing = true;
    this.erasedThisStroke = false;
    this.mouse = e.world;
    this.rub(e.world, ctx);
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    if (this.erasing) {
      this.rub(e.world, ctx);
      return;
    }
    this.target = ctx.eraseTargetAt(e.world);
    ctx.requestRender();
  }

  onPointerUp(): void {
    this.erasing = false;
    this.erasedThisStroke = false;
  }

  cancel(): void {
    this.erasing = false;
    this.erasedThisStroke = false;
    this.target = null;
    this.mouse = null;
  }

  /** Takes whatever is under the point, then re-aims at what is now on top. */
  private rub(at: Point, ctx: ToolContext): void {
    if (ctx.eraseAt(at, this.erasedThisStroke)) this.erasedThisStroke = true;
    this.target = ctx.eraseTargetAt(at);
    ctx.requestRender();
  }

  preview(): ToolPreview {
    if (!this.mouse) return EMPTY_PREVIEW;
    return {
      ...EMPTY_PREVIEW,
      // Red and dashed, which the overlay already draws for an outline that is
      // a warning rather than a proposal. Empty over open ground: nothing there
      // is about to go, and the badge alone says the eraser is the tool in hand.
      pendingPolygons: this.target ? this.target.outlines : [],
      pendingPolygonsInvalid: true,
      // The same target said twice, because it is drawn on two canvases: the
      // outline on the overlay above, the faded fill by the layer underneath.
      erasing: this.target,
      cursorGhost: { kind: 'eraser', at: this.mouse, size: 0 },
    };
  }
}
