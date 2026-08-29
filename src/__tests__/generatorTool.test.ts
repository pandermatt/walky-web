import { describe, it, expect } from 'vitest';
import { GeneratorTool } from '../tools/generatorTool';
import { DEFAULT_SETTINGS, GENERATOR_CELLS } from '../state/model';
import type { Point } from '../sim/geometry';
import type { PointerInfo, ToolContext, ToolId } from '../tools/types';

interface Recorded {
  /** Points the tool asked to put a generator on. */
  placed: Point[];
  messages: string[];
  /** Tool the context was asked to arm; null is "nothing armed". */
  armed: (ToolId | null)[];
}

/**
 * @param room whether the block at a point has anywhere to stand -- the one
 *   thing the app can refuse a placement for.
 */
function stubContext(room: (at: Point) => boolean = () => true): { ctx: ToolContext; rec: Recorded } {
  const rec: Recorded = { placed: [], messages: [], armed: [] };
  const ctx = {
    addWall: () => true,
    addWallShape: () => true,
    settings: () => DEFAULT_SETTINGS,
    pedestrianBlock: (at: Point) => (room(at) ? [at] : []),
    addPedestrians: () => {},
    addGenerator: (at: Point) => {
      if (!room(at)) return false;
      rec.placed.push(at);
      return true;
    },
    setGoalAt: () => false,
    selectPedestrianAt: () => {},
    selectPedestriansIn: () => {},
    clearSelection: () => {},
    selectionCount: () => 0,
    deactivateTool: () => rec.armed.push(null),
    activateTool: (id: ToolId) => rec.armed.push(id),
    notify: (message: string) => rec.messages.push(message),
    panBy: () => {},
    requestRender: () => {},
    colorAt: () => null,
    agentPositions: () => [],
    worldPerPixel: () => 1,
    eraseTargetAt: () => null,
    eraseAt: () => false,
    editTextAt: () => {},
  } satisfies ToolContext;
  return { ctx, rec };
}

function at(world: Point, buttons = 1): PointerInfo {
  return { world, screen: world, dxScreen: 0, dyScreen: 0, shiftKey: false, buttons };
}

describe('GeneratorTool', () => {
  it('puts a generator where it is clicked', () => {
    const { ctx, rec } = stubContext();
    new GeneratorTool().onPointerDown(at([40, 70]), ctx);
    expect(rec.placed).toEqual([[40, 70]]);
  });

  /**
   * The difference from the pedestrian brush, and the reason this tool exists as
   * its own file rather than as a flag on that one: paint is a quantity, a door
   * is a thing.
   */
  it('does not paint a row of them across a drag', () => {
    const { ctx, rec } = stubContext();
    const tool = new GeneratorTool();
    tool.onPointerDown(at([40, 70]), ctx);
    tool.onPointerMove(at([60, 70]), ctx);
    tool.onPointerMove(at([80, 70]), ctx);
    expect(rec.placed).toEqual([[40, 70]]);
  });

  it('stays in hand afterwards, so a second door is not a trip to the toolbar', () => {
    const { ctx, rec } = stubContext();
    new GeneratorTool().onPointerDown(at([40, 70]), ctx);
    expect(rec.armed).toEqual([]);
  });

  it('ignores anything but the left button', () => {
    const { ctx, rec } = stubContext();
    new GeneratorTool().onPointerDown(at([40, 70], 2), ctx);
    expect(rec.placed).toEqual([]);
  });

  /** The footprint is the radius' business, so the preview has to be too. */
  it('previews the block at the size the pedestrians coming out of it will be', () => {
    const { ctx } = stubContext();
    const tool = new GeneratorTool();
    expect(tool.preview().pendingPolygons).toEqual([]);

    tool.onPointerMove(at([0, 0]), ctx);
    const [square] = tool.preview().pendingPolygons;
    const half = GENERATOR_CELLS * DEFAULT_SETTINGS.pedestrianRadius;
    expect(square).toEqual([[-half, -half], [half, -half], [half, half], [-half, half]]);
    // A proposal, not a warning: the red outline means "about to be taken away".
    expect(tool.preview().pendingPolygonsInvalid).toBe(false);
  });

  it('goes red where there is no room to let anybody out, and says so on a click', () => {
    const { ctx, rec } = stubContext(() => false);
    const tool = new GeneratorTool();
    tool.onPointerMove(at([0, 0]), ctx);
    expect(tool.preview().pendingPolygonsInvalid).toBe(true);

    tool.onPointerDown(at([0, 0]), ctx);
    expect(rec.placed).toEqual([]);
    expect(rec.messages).toEqual([expect.stringContaining('No room for a generator')]);
  });

  it('forgets the preview when it is put down', () => {
    const { ctx } = stubContext();
    const tool = new GeneratorTool();
    tool.onPointerMove(at([10, 10]), ctx);
    tool.cancel();
    expect(tool.preview().pendingPolygons).toEqual([]);
  });
});
