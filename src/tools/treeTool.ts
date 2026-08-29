import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Places trees. In the original, trees only ever arrived from an OpenStreetMap
 * import (natural=tree nodes); with the import out of scope they need a tool of
 * their own to exist at all.
 */
export class TreeTool implements Tool {
  readonly id = 'tree' as const;
  readonly cursor = 'crosshair';

  private mouse: Point | null = null;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    ctx.addTree(e.world);
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    ctx.requestRender();
  }

  cancel(): void { this.mouse = null; }

  preview(): ToolPreview {
    return {
      ...EMPTY_PREVIEW,
      cursorGhost: this.mouse ? { kind: 'tree', at: this.mouse, size: 22 } : null,
    };
  }
}
