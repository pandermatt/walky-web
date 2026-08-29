import { distance, type Point } from '../sim/geometry';
import { EMPTY_PREVIEW, cursorUrl, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Freehand polygon wall, ported from controller/WallToolMouseListener.
 *
 * Click to place points, double-click to close the polygon. The original refused
 * points closer than a minimum distance to the previous one, to stop a shaky hand
 * producing hundreds of near-duplicate vertices.
 */
const MINIMUM_DISTANCE = 10;

export class WallTool implements Tool {
  readonly id = 'wall' as const;
  readonly cursor = cursorUrl('poly');
  private points: Point[] = [];

  onPointerDown(e: PointerInfo): void {
    if (e.buttons !== 1) return;
    this.addPoint(e.world, false);
  }

  onPointerMove(_e: PointerInfo, ctx: ToolContext): void {
    // The rubber-band segment is drawn by the overlay from the shared cursor
    // position, so the tool only needs to ask for a repaint.
    if (this.points.length > 0) ctx.requestRender();
  }

  onDoubleClick(e: PointerInfo, ctx: ToolContext): void {
    this.addPoint(e.world, true);
    if (this.points.length >= 3) ctx.addWall(this.points);
    this.cancel();
    ctx.requestRender();
  }

  cancel(): void {
    this.points = [];
  }

  preview(): ToolPreview {
    return { ...EMPTY_PREVIEW, pendingWallPoints: this.points };
  }

  private addPoint(p: Point, force: boolean): void {
    const last = this.points[this.points.length - 1];
    if (!force && last && distance(last, p) < MINIMUM_DISTANCE) return;
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    this.points.push([Math.round(p[0]), Math.round(p[1])]);
  }
}
