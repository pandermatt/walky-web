import { describe, it, expect } from 'vitest';
import { BorderTool } from '../tools/borderTool';
import type { PointerInfo, ToolContext } from '../tools/types';
import {
  DEFAULT_SETTINGS, borderFrame, borderFits, makeWall, rectanglePolygon, type WallOptions,
} from '../state/model';
import { Navigation } from '../sim/navigation';
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import type { Point } from '../sim/geometry';

const R = 13;
const PREF = 30;
const T = 12;

const A: Point = [0, 0];
const B: Point = [500, 400];

describe('borderFrame', () => {
  it('builds four bars that overlap at the corners', () => {
    const bars = borderFrame(A, B, T);
    expect(bars).toHaveLength(4);
    // Every corner of the rectangle is covered by two bars, which is what stops a
    // pedestrian slipping through a diagonal gap.
    for (const corner of [[0, 0], [500, 0], [0, 400], [500, 400]] as Point[]) {
      const covering = bars.filter((bar) => {
        const xs = bar.map((p) => p[0]);
        const ys = bar.map((p) => p[1]);
        return corner[0] >= Math.min(...xs) && corner[0] <= Math.max(...xs)
          && corner[1] >= Math.min(...ys) && corner[1] <= Math.max(...ys);
      });
      expect(covering.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is orientation independent', () => {
    expect(borderFrame(A, B, T)).toEqual(borderFrame(B, A, T));
  });
});

describe('borderFits', () => {
  it('accepts a frame with room inside and rejects one without', () => {
    expect(borderFits(A, B, T, R)).toBe(true);
    // Interior shrinks by thickness + radius on each side; this leaves nothing.
    expect(borderFits([0, 0], [40, 40], T, R)).toBe(false);
    expect(borderFits([0, 0], [500, 40], T, R)).toBe(false);
  });
});

describe('an enclosure encloses', () => {
  function enclosed(goalInside: boolean) {
    const frame = makeWall(borderFrame(A, B, T));
    // A goal either inside the sandbox or well outside it.
    const goal = goalInside
      ? makeWall([rectanglePolygon([380, 300], [430, 350])])
      : makeWall([rectanglePolygon([900, 150], [960, 250])]);
    goal.isGoal = true;

    const nav = new Navigation();
    nav.rebuild([frame, goal], R);
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([120, 120]);
    agents.setGoal(i, goal.id, goal.color);
    return { nav, agents, hash, i };
  }

  it('never lets a pedestrian out, however hard it tries to reach a goal outside', () => {
    const { nav, agents, hash, i } = enclosed(false);
    for (let t = 0; t < 6000; t++) {
      agents.step(nav, hash, 6, R, PREF);
      // Inside the bars at all times. A corner leak would show up here.
      expect(agents.x[i]).toBeGreaterThan(T);
      expect(agents.x[i]).toBeLessThan(500 - T);
      expect(agents.y[i]).toBeGreaterThan(T);
      expect(agents.y[i]).toBeLessThan(400 - T);
    }
    expect(agents.arrived[i]).toBe(0);
  });

  it('still lets it reach a goal inside the sandbox', () => {
    const { nav, agents, hash, i } = enclosed(true);
    for (let t = 0; t < 4000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 6, R, PREF);
    }
    expect(agents.arrived[i]).toBe(1);
  });

  it('leaves the interior open enough to walk around an obstacle in it', () => {
    const frame = makeWall(borderFrame(A, B, T));
    const blocker = makeWall([rectanglePolygon([200, 100], [260, 300])]);
    const goal = makeWall([rectanglePolygon([400, 180], [450, 230])]);
    goal.isGoal = true;

    const nav = new Navigation();
    nav.rebuild([frame, blocker, goal], R);
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([90, 200]);
    agents.setGoal(i, goal.id, goal.color);

    for (let t = 0; t < 6000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 6, R, PREF);
    }
    expect(agents.arrived[i]).toBe(1);
  });
});

describe('BorderTool', () => {
  /** A context that records what the tool commits and nothing else. */
  function stubContext(): { ctx: ToolContext; walls: { polygons: Point[][]; options?: WallOptions }[] } {
    const walls: { polygons: Point[][]; options?: WallOptions }[] = [];
    const ctx = {
      addWall: () => true,
      addWallShape: (polygons: Point[][], options?: WallOptions) => {
        walls.push({ polygons, options });
        return true;
      },
      settings: () => DEFAULT_SETTINGS,
      pedestrianBlock: () => [],
      addPedestrians: () => {},
      setGoalAt: () => false,
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

  it('marks the frame it commits as a border, so the hull grouping skips it', () => {
    const { ctx, walls } = stubContext();
    const tool = new BorderTool();

    tool.onPointerDown(at(A), ctx);
    tool.onPointerMove(at(B), ctx);
    tool.onPointerUp(at(B, 0), ctx);

    expect(walls).toHaveLength(1);
    expect(walls[0].polygons).toHaveLength(4);
    expect(walls[0].options?.isBorder).toBe(true);
  });
});
