import { rectanglePolygon } from '../state/model';
import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, cursorUrl, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Rectangular wall, ported from controller/RectangleWallToolMouseListener:
 * one click sets a corner, the second completes the rectangle.
 */
export class RectangleTool implements Tool {
  readonly id = 'rectangle' as const;
  readonly cursor = cursorUrl('square');
  private first: Point | null = null;
  private mouse: Point | null = null;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    if (!this.first) {
      this.first = [Math.round(e.world[0]), Math.round(e.world[1])];
      return;
    }
    const second: Point = [Math.round(e.world[0]), Math.round(e.world[1])];
    if (Math.abs(second[0] - this.first[0]) >= 1 && Math.abs(second[1] - this.first[1]) >= 1) {
      ctx.addWall(rectanglePolygon(this.first, second));
    }
    this.cancel();
    ctx.requestRender();
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    if (this.first) ctx.requestRender();
  }

  cancel(): void {
    this.first = null;
    this.mouse = null;
  }

  preview(): ToolPreview {
    if (!this.first || !this.mouse) return EMPTY_PREVIEW;
    return { ...EMPTY_PREVIEW, pendingRect: [this.first, this.mouse] };
  }
}
