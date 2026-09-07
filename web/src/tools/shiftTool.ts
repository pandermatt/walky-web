import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Pan, ported from ZoomMouseListener.shiftView. In the original, dragging only
 * moved the view while the shift tool was selected -- every other tool used drag
 * for its own purpose -- so panning stays a tool rather than a global gesture.
 */
export class ShiftTool implements Tool {
  readonly id = 'shift' as const;
  readonly cursor = 'grab';
  private dragging = false;

  onPointerDown(): void { this.dragging = true; }
  onPointerUp(): void { this.dragging = false; }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    if (!this.dragging || e.buttons === 0) return;
    ctx.panBy(e.dxScreen, e.dyScreen);
    ctx.requestRender();
  }

  cancel(): void { this.dragging = false; }
  preview(): ToolPreview { return EMPTY_PREVIEW; }
}
