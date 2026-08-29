import { describe, expect, it } from 'vitest';
import {
  SCENARIO_VERSION, buildWorld, clampSettings, scenarioToJson, serializeCore, serializeScenario,
  type ScenarioCore, type SerializedAgent,
} from '../state/scenario';
import { DEFAULT_SETTINGS, makeWall, rectanglePolygon, type Settings } from '../state/model';
import { BLACK } from '../palette';

function agent(over: Partial<SerializedAgent> = {}): SerializedAgent {
  return { x: 0, y: 0, originX: 0, originY: 0, goal: -1, arrived: false, color: [1, 2, 3], ...over };
}

function core(over: Partial<ScenarioCore> = {}): ScenarioCore {
  return {
    version: SCENARIO_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    view: { targetX: 0, targetY: 0, zoomLevel: 0 },
    walls: [],
    agents: [],
    ...over,
  };
}

describe('the snapshot', () => {
  it('rounds every coordinate to two decimals', () => {
    const wall = makeWall([rectanglePolygon([0.126, 0.124], [10.005, 10])]);
    const out = serializeCore({
      settings: DEFAULT_SETTINGS,
      view: { targetX: 1.239, targetY: -4.005, zoomLevel: 0 },
      walls: [wall],
      agents: [agent({ x: 1.239, y: 2.341 })],
    });
    expect(out.walls[0].polygons[0][0]).toEqual([0.13, 0.12]);
    expect(out.view.targetX).toBe(1.24);
    expect(out.agents[0].x).toBe(1.24);
  });

  it('counts what the report is read for', () => {
    const goal = makeWall([rectanglePolygon([0, 0], [10, 10])]);
    goal.isGoal = true;
    const scenario = serializeScenario({
      settings: DEFAULT_SETTINGS,
      view: { targetX: 0, targetY: 0, zoomLevel: 0 },
      walls: [goal, makeWall([rectanglePolygon([20, 0], [30, 10])])],
      agents: [agent({ arrived: true }), agent(), agent()],
      stuck: [false, true, false],
    });
    expect(scenario.summary).toEqual({ walls: 2, goals: 1, agents: 3, arrived: 1, stuck: 1 });
    expect(scenario.agents.map((a) => a.stuck)).toEqual([false, true, false]);
    expect(JSON.parse(scenarioToJson(scenario)).summary.walls).toBe(2);
  });

  it('carries the pedestrian colour, which is what the map looks like', () => {
    const out = serializeCore({
      settings: DEFAULT_SETTINGS,
      view: { targetX: 0, targetY: 0, zoomLevel: 0 },
      walls: [],
      agents: [agent({ color: [9, 8, 7] })],
    });
    expect(out.agents[0].color).toEqual([9, 8, 7]);
  });

  it('leaves the report\'s own extras out of the core', () => {
    const out = serializeCore({
      settings: DEFAULT_SETTINGS,
      view: { targetX: 0, targetY: 0, zoomLevel: 0 },
      walls: [],
      agents: [agent()],
    });
    expect(out).not.toHaveProperty('created');
    expect(out).not.toHaveProperty('summary');
    expect(out.agents[0]).not.toHaveProperty('stuck');
  });
});

describe('settings out of an untrusted map', () => {
  it('pins every number into the range its slider allows', () => {
    const clamped = clampSettings({
      speed: 9999, pedestrianRadius: -4, preferredSpace: 1000, brushSize: 0, borderThickness: 1,
    });
    expect(clamped.speed).toBe(20);
    expect(clamped.pedestrianRadius).toBe(3);
    expect(clamped.preferredSpace).toBe(90);
    expect(clamped.brushSize).toBe(1);
    expect(clamped.borderThickness).toBe(2);
  });

  it('falls back to the default for anything that is not a number', () => {
    const clamped = clampSettings({
      speed: NaN, pedestrianRadius: Infinity,
      preferredSpace: undefined, showDebug: 'yes' as unknown as boolean,
    });
    expect(clamped.speed).toBe(DEFAULT_SETTINGS.speed);
    expect(clamped.pedestrianRadius).toBe(DEFAULT_SETTINGS.pedestrianRadius);
    expect(clamped.preferredSpace).toBe(DEFAULT_SETTINGS.preferredSpace);
    expect(clamped.showDebug).toBe(DEFAULT_SETTINGS.showDebug);
  });

  it('keeps every toggle that really is one', () => {
    const clamped = clampSettings({ showDebug: true, sound: false, showConvexHull: false });
    expect(clamped.showDebug).toBe(true);
    expect(clamped.sound).toBe(false);
    expect(clamped.showConvexHull).toBe(false);
  });

  it('changes nothing the second time -- which is what makes it safe to call twice', () => {
    const once = clampSettings({ speed: 9999, showDebug: true } as Partial<Settings>);
    expect(clampSettings(once)).toEqual(once);
  });

  it('gives the defaults for nothing at all', () => {
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('building a world out of a snapshot', () => {
  const snapshot = () => core({
    walls: [
      { id: 100, polygons: [rectanglePolygon([0, 0], [10, 10])], color: [1, 2, 3], isGoal: false },
      { id: 101, polygons: [rectanglePolygon([20, 0], [30, 10])], color: [255, 190, 0], isGoal: true },
    ],
    agents: [
      agent({ x: 1, y: 1, goal: 101, color: [255, 190, 0] }),
      agent({ x: 2, y: 2, goal: 100, color: [1, 2, 3] }),
      agent({ x: 3, y: 3, goal: 999, color: [7, 7, 7] }),
      agent({ x: 4, y: 4, goal: 101, arrived: true, color: [255, 190, 0] }),
    ],
  });

  it('gives every wall a fresh id that cannot collide with the stored one', () => {
    const { walls } = buildWorld(snapshot());
    const ids = walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(100);
    expect(ids).not.toContain(101);
  });

  it('carries every goal across to the new id, and drops one that names no wall', () => {
    const world = buildWorld(snapshot());
    const [first, second] = world.walls.map((w) => w.id);
    expect(world.agents.map((a) => a.goal)).toEqual([second, first, -1, second]);
  });

  it('keeps the goal on the wall that had it, and the colours it was drawn with', () => {
    const { walls } = buildWorld(snapshot());
    expect(walls.map((w) => w.isGoal)).toEqual([false, true]);
    expect(walls.map((w) => w.color)).toEqual([[1, 2, 3], [255, 190, 0]]);
  });

  it('recomputes the hull rather than trusting a stored one', () => {
    const { walls } = buildWorld(snapshot());
    expect(walls[0].hull.length).toBe(4);
  });

  it('makes an arrived pedestrian black, because that is what arriving does', () => {
    const { agents } = buildWorld(snapshot());
    expect(agents[3].color).toEqual(BLACK);
    expect(agents[0].color).toEqual([255, 190, 0]);
  });

  it('drops a shape too thin to be one, and a wall left with none', () => {
    const world = buildWorld(core({
      walls: [
        { id: 1, polygons: [[[0, 0], [1, 1]]], color: [1, 2, 3], isGoal: false },
        { id: 2, polygons: [[[0, 0]], rectanglePolygon([0, 0], [10, 10])], color: [1, 2, 3], isGoal: false },
      ],
      agents: [agent({ goal: 1 })],
    }));
    expect(world.walls).toHaveLength(1);
    expect(world.walls[0].polygons).toHaveLength(1);
    // Its goal did not survive, so neither does the assignment.
    expect(world.agents[0].goal).toBe(-1);
  });

  it('keeps a pedestrian that has moved away from where it started', () => {
    const { agents } = buildWorld(core({
      agents: [agent({ x: 90, y: 90, originX: 10, originY: 10 })],
    }));
    expect(agents[0]).toMatchObject({ x: 90, y: 90, originX: 10, originY: 10 });
  });

});
