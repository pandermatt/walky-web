import { BLACK, type RGB } from '../palette';
import type { Point } from '../sim/geometry';
import {
  DEFAULT_SETTINGS, SETTING_RANGES, makeWall,
  type NumericSetting, type Settings, type Wall,
} from './model';

/**
 * A snapshot of everything on the map, as plain JSON.
 *
 * Exists so a scenario can be handed to someone else verbatim -- notably to
 * reproduce a case where pedestrians get stuck, which depends on the exact
 * positions, goals and settings involved and is otherwise near-impossible to
 * describe. Also the basis for saving and loading, and for the shared link.
 *
 * Version 2 added the pedestrian colour and dropped the trees. The colour
 * matters now that a snapshot can be opened again rather than only read: a
 * pedestrian takes the colour of the goal it is heading for, so a snapshot
 * without it describes a map that looks different from the one it was taken of.
 */
export const SCENARIO_VERSION = 2;

/**
 * A pedestrian as it is stored: where it is, where it started, and what it is
 * doing. Everything else about an agent -- its waypoint, its step budget, its
 * distance to the goal -- is recomputed from the map on the next tick.
 */
export interface SerializedAgent {
  x: number;
  y: number;
  originX: number;
  originY: number;
  /** Goal wall id, or -1 when unassigned. */
  goal: number;
  arrived: boolean;
  color: RGB;
}

/**
 * A pedestrian in the JSON report, which adds a fact the map alone does not
 * carry: whether there is currently any route from where it stands.
 *
 * Derived from the navigation graph rather than stored, so it is written out for
 * a reader and never read back in.
 */
export interface ReportedAgent extends SerializedAgent {
  /** Set when the pedestrian has no route: the thing worth looking at. */
  stuck: boolean;
}

export interface SerializedWall {
  id: number;
  polygons: Point[][];
  color: RGB;
  isGoal: boolean;
  /** False for shapes not outlined until they touch something; see Wall.outlinedAlone. */
  outlinedAlone: boolean;
}

/**
 * Everything a map *is*: what a shared link carries and what an import restores.
 *
 * The report below adds a timestamp, a summary and the stuck flags. Those are
 * descriptive or derived -- a link that carried them would be claiming the
 * sender's clock and the sender's navigation graph as facts about the recipient's
 * map -- so the codec encodes this narrower type and nothing else.
 */
export interface ScenarioCore {
  version: number;
  settings: Settings;
  view: { targetX: number; targetY: number; zoomLevel: number };
  walls: SerializedWall[];
  agents: SerializedAgent[];
}

/** A core plus the descriptive extras the JSON report carries. */
export interface Scenario extends ScenarioCore {
  created: string;
  agents: ReportedAgent[];
  /** Quick read on the state of the run, so a report is legible at a glance. */
  summary: {
    walls: number;
    goals: number;
    agents: number;
    arrived: number;
    stuck: number;
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

export interface ScenarioInput {
  settings: Settings;
  view: { targetX: number; targetY: number; zoomLevel: number };
  walls: Wall[];
  agents: SerializedAgent[];
}

/** The map itself, with every coordinate rounded to two decimals. */
export function serializeCore(input: ScenarioInput): ScenarioCore {
  return {
    version: SCENARIO_VERSION,
    settings: { ...input.settings },
    view: {
      targetX: round(input.view.targetX),
      targetY: round(input.view.targetY),
      zoomLevel: input.view.zoomLevel,
    },
    walls: input.walls.map((w) => ({
      id: w.id,
      polygons: w.polygons.map((poly) => poly.map(([x, y]) => [round(x), round(y)] as Point)),
      color: w.color,
      isGoal: w.isGoal,
      outlinedAlone: w.outlinedAlone,
    })),
    agents: input.agents.map((a) => ({
      x: round(a.x),
      y: round(a.y),
      originX: round(a.originX),
      originY: round(a.originY),
      goal: a.goal,
      arrived: a.arrived,
      color: a.color,
    })),
  };
}

/**
 * The report: the map, plus when it was taken, which pedestrians are stuck, and
 * a summary line.
 *
 * `stuck` comes in per agent because only the caller holds the navigation graph
 * that can answer it.
 */
export function serializeScenario(input: ScenarioInput & { stuck: boolean[] }): Scenario {
  const core = serializeCore(input);
  const agents: ReportedAgent[] = core.agents.map((a, i) => ({ ...a, stuck: input.stuck[i] === true }));
  return {
    ...core,
    created: new Date().toISOString(),
    agents,
    summary: {
      walls: core.walls.length,
      goals: core.walls.filter((w) => w.isGoal).length,
      agents: agents.length,
      arrived: agents.filter((a) => a.arrived).length,
      stuck: agents.filter((a) => a.stuck).length,
    },
  };
}

export function scenarioToJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

/**
 * Settings from an untrusted source, made legal.
 *
 * A link is typed, pasted and truncated by hand, so nothing in it can be taken
 * at its word. The ranges are the sliders' own, read from the model so that
 * loading a map does not depend on a control existing.
 *
 * Idempotent: clamping a clamped scenario changes nothing. That is what makes it
 * safe to call from more than one import path.
 */
export function clampSettings(input: Partial<Settings> | null | undefined): Settings {
  const out = { ...DEFAULT_SETTINGS };
  if (!input) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = input[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') (out[key] as boolean) = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const range = SETTING_RANGES[key as NumericSetting];
    const clamped = range ? Math.min(range.max, Math.max(range.min, value)) : value;
    (out[key] as number) = Math.round(clamped);
  }
  return out;
}

/** A pedestrian ready to be put back, with its goal already pointing at a live wall. */
export interface RestoredAgent {
  x: number;
  y: number;
  originX: number;
  originY: number;
  /** The id of a wall that exists now, or -1. */
  goal: number;
  arrived: boolean;
  color: RGB;
}

/**
 * The interesting half of loading a map: fresh walls, and every goal repointed
 * at them.
 *
 * Wall ids come from a module counter in model.ts that never resets, so an
 * imported wall gets an id that has never been used and cannot collide with
 * anything -- but that also means the ids in the payload are not the ids the map
 * will have, and every agent's goal has to be carried across. Doing it here,
 * away from the App, is what lets it be tested without a browser.
 *
 * Shapes with fewer than three points are dropped, matching what
 * App.addWallShape already refuses to accept from a tool.
 */
export function buildWorld(core: ScenarioCore): { walls: Wall[]; agents: RestoredAgent[] } {
  const walls: Wall[] = [];
  const idMap = new Map<number, number>();
  for (const sw of core.walls) {
    const polygons = sw.polygons.filter((poly) => poly.length >= 3);
    if (polygons.length === 0) continue;
    const wall = makeWall(polygons, { color: sw.color, outlinedAlone: sw.outlinedAlone });
    wall.isGoal = sw.isGoal;
    walls.push(wall);
    idMap.set(sw.id, wall.id);
  }

  const agents: RestoredAgent[] = core.agents.map((a) => {
    // A goal naming a wall that did not survive is simply no goal: an
    // unassigned pedestrian is a state the map already has a meaning for.
    const goal = idMap.get(a.goal) ?? -1;
    return {
      x: a.x,
      y: a.y,
      originX: a.originX,
      originY: a.originY,
      goal,
      // An arrived pedestrian is black, as markArrived makes it. Its stored
      // colour is whatever it wore on the way, which is not what it looks like now.
      color: a.arrived ? BLACK : a.color,
      arrived: a.arrived,
    };
  });

  return { walls, agents };
}
