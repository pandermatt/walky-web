import { distance, type Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/** A press that travelled this far was a drag, and a drag is not a click. */
const DRAG_THRESHOLD = 6;

/**
 * Writes on the map: click where the word goes, then type it.
 *
 * There is no shape to preview and no size to show, so this tool draws nothing
 * under the pointer -- the `text` cursor is the whole affordance, which is what
 * that cursor is for and what every other program that writes on a canvas uses.
 *
 * It commits on release rather than on press, and only from a press that stayed
 * put: a drag across the map is somebody who meant to pan or who changed their
 * mind, and neither should leave a caret behind.
 *
 * Desktop only, as the strip it is reached from says: a caret with no keyboard
 * under it is a place to type that cannot be typed into.
 */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly cursor = 'text';
  private pressAt: Point | null = null;

  onPointerDown(e: PointerInfo): void {
    if (e.buttons !== 1) return;
    this.pressAt = e.world;
  }

  onPointerUp(e: PointerInfo, ctx: ToolContext): void {
    const from = this.pressAt;
    this.pressAt = null;
    if (!from) return;
    // In world units, so the threshold is the same six pixels at every zoom.
    if (distance(from, e.world) >= DRAG_THRESHOLD * ctx.worldPerPixel()) return;
    ctx.editTextAt(e.world);
  }

  cancel(): void {
    this.pressAt = null;
  }

  preview(): ToolPreview {
    return EMPTY_PREVIEW;
  }
}
