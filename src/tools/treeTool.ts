import { EMPTY_PREVIEW, cursorUrl, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Places trees. In the original, trees only ever arrived from an OpenStreetMap
 * import (natural=tree nodes); with the import out of scope they need a tool of
 * their own to exist at all.
 */
export class TreeTool implements Tool {
  readonly id = 'tree' as const;
  readonly cursor = cursorUrl('no', 16, 16);

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    ctx.addTree(e.world);
  }

  preview(): ToolPreview { return EMPTY_PREVIEW; }
}
