import { borderFits, borderFrame } from '../state/model';
import { distance, type Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Draws an enclosure: a hollow rectangular frame, from
 * controller/BorderToolMouseListener.
 *
 * This is the only tool that makes a shape with an inside. Every other tool
 * produces a filled polygon, so tracing a boundary with them gives a solid blob
 * rather than a room.
 *
 * The frame is committed as a single wall of four bars, not as four walls. It is
 * one object conceptually -- select it, colour it, delete it as a unit -- and
 * building it atomically means it never depends on walls being merged together,
 * which is what used to make enclosures swallow everything drawn against them.
 */
/**
 * Past this, a press-and-release counts as a drag rather than the first of two
 * clicks. **Pixels of finger travel, not world units** -- so it is multiplied by
 * `worldPerPixel()` at the comparison, exactly as `wallTool.ts` and
 * `textTool.ts` already do.
 *
 * It was compared raw for a long time. At zoom 0 the two readings coincide,
 * which is why nothing showed on a desktop; zoomed out five notches a 6-unit
 * drag is under 4pt of finger travel, so on a phone every tap became a drag and
 * two-click mode was unreachable. The iOS port fixed this first and left a note
 * saying the same fix was owed here.
 */
const DRAG_THRESHOLD = 6;

export class BorderTool implements Tool {
  readonly id = 'border' as const;
  readonly cursor = 'crosshair';

  private first: Point | null = null;
  private pressAt: Point | null = null;
  private mouse: Point | null = null;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    this.pressAt = snap(e.world);
    this.mouse = e.world;
    this.readSettings(ctx);
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    // preview() has no context, so the sizes it needs are cached on the way past.
    this.readSettings(ctx);
    ctx.requestRender();
  }

  onPointerUp(e: PointerInfo, ctx: ToolContext): void {
    const press = this.pressAt;
    this.pressAt = null;
    if (!press) return;
    const here = snap(e.world);

    if (distance(press, here) >= DRAG_THRESHOLD * ctx.worldPerPixel()) {
      this.commit(press, here, ctx);
      return;
    }
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
    if (!anchor || !this.mouse) {
      return {
        ...EMPTY_PREVIEW,
        cursorGhost: this.mouse ? { kind: 'frame', at: this.mouse, size: 9 } : null,
      };
    }
    return {
      ...EMPTY_PREVIEW,
      pendingPolygons: borderFrame(anchor, this.mouse, this.thickness),
      // Drawn in warning colour when the frame would have no usable interior.
      pendingPolygonsInvalid: !borderFits(anchor, this.mouse, this.thickness, this.radius),
    };
  }

  private thickness = 12;
  private radius = 13;

  private readSettings(ctx: ToolContext): void {
    const s = ctx.settings();
    this.thickness = s.borderThickness;
    this.radius = s.pedestrianRadius;
  }

  private commit(a: Point, b: Point, ctx: ToolContext): void {
    if (borderFits(a, b, this.thickness, this.radius)) {
      // Flagged as a border: the dashed hull skips it, since a frame's hull is
      // the room it encloses rather than the shape itself. See Wall.isBorder.
      ctx.addWallShape(borderFrame(a, b, this.thickness), { isBorder: true });
    }
    this.cancel();
    ctx.requestRender();
  }
}

function snap(p: Point): Point {
  return [Math.round(p[0]), Math.round(p[1])];
}
