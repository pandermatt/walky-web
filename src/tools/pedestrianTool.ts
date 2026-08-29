import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, cursorUrl, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Adds pedestrians, ported from controller/PedestrianMouseListener: a click drops
 * an n x n block and dragging paints continuously, so a crowd can be laid down in
 * one gesture.
 */
export class PedestrianTool implements Tool {
  readonly id = 'pedestrian' as const;
  readonly cursor = cursorUrl('ped', 16, 16);
  private painting = false;
  /** Ghost dots for the block under the cursor, as drawTemporaryPedestrians did. */
  private ghost: Point[] = [];

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    this.painting = true;
    ctx.addPedestrians(e.world);
    this.ghost = ctx.pedestrianBlock(e.world);
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    if (this.painting && e.buttons !== 0) ctx.addPedestrians(e.world);
    // Recomputed after placing, so the preview shows only spots still free.
    this.ghost = ctx.pedestrianBlock(e.world);
    ctx.requestRender();
  }

  onPointerUp(): void { this.painting = false; }

  cancel(): void {
    this.painting = false;
    this.ghost = [];
  }

  preview(): ToolPreview {
    return { ...EMPTY_PREVIEW, pendingPedestrians: this.ghost };
  }
}
