import { describe, it, expect } from 'vitest';
import { WallTool } from '../tools/wallTool';
import { RectangleTool } from '../tools/rectangleTool';
import type { PointerInfo, ToolContext } from '../tools/types';
import { DEFAULT_SETTINGS, type WallOptions } from '../state/model';
import type { Point } from '../sim/geometry';

interface Committed {
  polygons: Point[][];
  options?: WallOptions;
}

/** A context that records what a tool commits and nothing else. */
function stubContext(): { ctx: ToolContext; walls: Committed[] } {
  const walls: Committed[] = [];
  const ctx = {
    addWall: (polygon: Point[], options?: WallOptions) => {
      walls.push({ polygons: [polygon], options });
      return true;
    },
    addWallShape: (polygons: Point[][], options?: WallOptions) => {
      walls.push({ polygons, options });
      return true;
    },
    settings: () => DEFAULT_SETTINGS,
    pedestrianBlock: () => [],
    addTree: () => {},
    addPedestrians: () => {},
    setGoalAt: () => {},
    selectPedestrianAt: () => {},
    selectPedestriansIn: () => {},
    clearSelection: () => {},
    selectionCount: () => 0,
    deactivateTool: () => {},
    panBy: () => {},
    requestRender: () => {},
    colorAt: () => null,
    agentPositions: () => [],
    worldPerPixel: () => 1,
  } satisfies ToolContext;
  return { ctx, walls };
}

function at(world: Point, buttons = 1): PointerInfo {
  return { world, screen: world, dxScreen: 0, dyScreen: 0, shiftKey: false, buttons };
}

describe('WallTool', () => {
  it('commits a traced shape that is not outlined until it touches something', () => {
    const { ctx, walls } = stubContext();
    const tool = new WallTool();
    tool.onPointerDown(at([0, 0]));
    for (const p of [[40, 0], [40, 40], [0, 40], [0, 10]] as Point[]) tool.onPointerMove(at(p), ctx);
    tool.onPointerUp(at([0, 10], 0), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].options?.outlinedAlone).toBe(false);
  });

  it('leaves a click-placed shape unoutlined alone too', () => {
    const { ctx, walls } = stubContext();
    const tool = new WallTool();
    for (const p of [[0, 0], [100, 0], [100, 100]] as Point[]) {
      tool.onPointerDown(at(p));
      tool.onPointerUp(at(p, 0), ctx);
    }
    tool.onDoubleClick(at([0, 100]), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].options?.outlinedAlone).toBe(false);
  });

  it('outlines a rectangle on its own: a box is a shape a hull describes', () => {
    const { ctx, walls } = stubContext();
    const tool = new RectangleTool();
    tool.onPointerDown(at([0, 0]));
    tool.onPointerMove(at([100, 80]), ctx);
    tool.onPointerUp(at([100, 80], 0), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].options?.outlinedAlone).not.toBe(false);
  });
});
