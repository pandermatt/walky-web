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
    addPedestrians: () => {},
    setGoalAt: () => {},
    selectPedestrianAt: () => {},
    selectPedestriansIn: () => {},
    clearSelection: () => {},
    selectionCount: () => 0,
    deactivateTool: () => {},
    activateTool: () => {},
    notify: () => {},
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
  it('commits one simplified polygon for a traced stroke', () => {
    const { ctx, walls } = stubContext();
    const tool = new WallTool();
    const stroke: Point[] = [];
    // A square traced at a point every few units, as the pointer reports it.
    for (let x = 0; x <= 40; x += 4) stroke.push([x, 0]);
    for (let y = 4; y <= 40; y += 4) stroke.push([40, y]);
    for (let x = 36; x >= 0; x -= 4) stroke.push([x, 40]);
    for (let y = 36; y >= 10; y -= 4) stroke.push([0, y]);

    tool.onPointerDown(at([0, 0]));
    for (const p of stroke) tool.onPointerMove(at(p), ctx);
    tool.onPointerUp(at(stroke[stroke.length - 1], 0), ctx);

    expect(walls).toHaveLength(1);
    const [polygon] = walls[0].polygons;
    // Simplified: the corners survive, the points along each side do not.
    expect(polygon.length).toBeGreaterThanOrEqual(3);
    expect(polygon.length).toBeLessThan(stroke.length / 2);
    for (const corner of [[0, 0], [40, 0], [40, 40], [0, 40]]) {
      expect(polygon).toContainEqual(corner);
    }
  });

  it('commits the placed vertices in click mode, closed by a double click', () => {
    const { ctx, walls } = stubContext();
    const tool = new WallTool();
    for (const p of [[0, 0], [100, 0], [100, 100]] as Point[]) {
      tool.onPointerDown(at(p));
      tool.onPointerUp(at(p, 0), ctx);
    }
    tool.onDoubleClick(at([0, 100]), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].polygons).toEqual([[[0, 0], [100, 0], [100, 100], [0, 100]]]);
  });

  it('commits a box for the rectangle tool, dragged corner to corner', () => {
    const { ctx, walls } = stubContext();
    const tool = new RectangleTool();
    tool.onPointerDown(at([0, 0]));
    tool.onPointerMove(at([100, 80]), ctx);
    tool.onPointerUp(at([100, 80], 0), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].polygons[0]).toHaveLength(4);
  });
});
