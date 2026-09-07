import { GENERATOR_CELLS, generatorRoundedSquare } from '../state/model';
import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Puts down a generator: a block that lets pedestrians out while the run is on.
 *
 * One click rather than the brush's stroke. The pedestrian tool paints, because a
 * crowd is a quantity and painting is how you say how much; a generator is a
 * single thing standing somewhere, and dragging would leave behind a row of doors
 * nobody meant to open.
 *
 * The preview is the real block at the real size and with the real rounded
 * corners rather than a cursor badge -- the footprint follows the pedestrian
 * radius, so drawing it is the only honest way to say how much room it is about
 * to take, and drawing the shape it will become is how it says which thing it is. It goes red where the block has
 * no room in it for anybody to stand, and a click there is refused: a door built
 * inside a wall could never let anybody out, which is the same bargain the
 * border tool strikes with a frame too small to hold a crowd.
 *
 * It stays armed after a placement, as the drawing tools do: several doors on one
 * map is the ordinary case, and stepping off after each one would be a trip back
 * to the strip every time.
 */
export class GeneratorTool implements Tool {
  readonly id = 'generator' as const;
  readonly cursor = 'crosshair';
  private mouse: Point | null = null;
  /** preview() has no context, so what it needs is cached on the way past. */
  private radius = 0;
  private blocked = false;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    this.mouse = e.world;
    this.read(e.world, ctx);
    if (ctx.addGenerator(e.world)) return;
    ctx.notify('No room for a generator there — it needs space to let people out into.');
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    this.read(e.world, ctx);
    ctx.requestRender();
  }

  cancel(): void {
    this.mouse = null;
    this.blocked = false;
  }

  /** The sizes and the verdict preview() will need, taken while there is a context. */
  private read(at: Point, ctx: ToolContext): void {
    this.radius = ctx.settings().pedestrianRadius;
    this.blocked = ctx.pedestrianBlock(at, GENERATOR_CELLS).length === 0;
  }

  preview(): ToolPreview {
    if (!this.mouse) return EMPTY_PREVIEW;
    return {
      ...EMPTY_PREVIEW,
      pendingPolygons: [generatorRoundedSquare(this.mouse, this.radius)],
      pendingPolygonsInvalid: this.blocked,
    };
  }
}
