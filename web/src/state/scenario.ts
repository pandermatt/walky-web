import { BLACK, type RGB } from '../palette';
import type { Point } from '../sim/geometry';
import {
  DEFAULT_SETTINGS, SETTING_RANGES, makeGenerator, makeLabel, makeWall,
  type Generator, type Label, type NumericSetting, type Settings, type Wall,
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
 * Version 3 added the border flag, for the same reason: a frame reopened as an
 * ordinary wall would swallow every outline on the map. Version 4 added the
 * labels: a map that says which door is which is a different map from one that
 * does not. Version 5 added the generators, and the flag saying which
 * pedestrians came out of one -- a flow reopened as a standing crowd is a
 * different map again.
 */
export const SCENARIO_VERSION = 5;

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
  /**
   * Whether a generator let this one out; see Agents.spawned. Optional, and read
   * with a default: a payload written before generators existed describes a map
   * where every pedestrian was painted by hand.
   */
  spawned?: boolean;
}

/**
 * A generator as it is stored: where the block is, how fast it lets people out,
 * and where they are headed. Its footprint is derived from the pedestrian radius
 * and its emission counter belongs to the run, so neither travels.
 */
export interface SerializedGenerator {
  at: Point;
  rate: number;
  /** Goal wall id, or -1 when unassigned. */
  goal: number;
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

/** A label as it is stored: where the word sits, the word, and how big it is. */
export interface SerializedLabel {
  at: Point;
  text: string;
  /** World-unit height and font weight, as the sliders were set when it was written. */
  size: number;
  weight: number;
}

export interface SerializedWall {
  id: number;
  polygons: Point[][];
  color: RGB;
  isGoal: boolean;
  /** Whether this wall is a border frame; see Wall.isBorder. */
  isBorder: boolean;
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
  /**
   * Optional, and read with a default everywhere: a payload written before
   * labels existed has no field here, and that is a map with nothing written on
   * it rather than a map that failed to load.
   */
  labels?: SerializedLabel[];
  /** Optional and defaulted, exactly as the labels are, and for the same reason. */
  generators?: SerializedGenerator[];
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
    labels: number;
    generators: number;
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A number from a payload, or the default when it is not one. */
const number = (v: unknown, fallback: number) => (
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
);

export interface ScenarioInput {
  settings: Settings;
  view: { targetX: number; targetY: number; zoomLevel: number };
  walls: Wall[];
  agents: SerializedAgent[];
  labels: Label[];
  generators: Generator[];
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
      isBorder: w.isBorder,
    })),
    agents: input.agents.map((a) => ({
      x: round(a.x),
      y: round(a.y),
      originX: round(a.originX),
      originY: round(a.originY),
      goal: a.goal,
      arrived: a.arrived,
      color: a.color,
      spawned: a.spawned === true,
    })),
    labels: input.labels.map((l) => ({
      at: [round(l.at[0]), round(l.at[1])] as Point,
      text: l.text,
      size: l.size,
      weight: l.weight,
    })),
    generators: input.generators.map((g) => ({
      at: [round(g.at[0]), round(g.at[1])] as Point,
      rate: g.rate,
      goal: g.goal,
      color: g.color,
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
      labels: core.labels?.length ?? 0,
      generators: core.generators?.length ?? 0,
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
    // Snapped to the slider's own grid rather than to whole numbers: speed
    // moved to metres per second with a step of 0.05, and rounding it to an
    // integer would quietly rewrite every loaded map's pace. The rounding
    // guards the same thing it always did -- a link is untrusted input, and
    // 1.30000000000004 is not a value a slider can hold.
    const step = range?.step ?? 1;
    // toFixed sands off the float grit of fractional steps: 12 * 0.05 is
    // 0.6000000000000001, and that is not a number to show beside a slider.
    (out[key] as number) = Number((Math.round(clamped / step) * step).toFixed(4));
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
  /** Whether a generator let it out, and so whether it goes when it arrives. */
  spawned: boolean;
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
export function buildWorld(
  core: ScenarioCore,
): { walls: Wall[]; agents: RestoredAgent[]; labels: Label[]; generators: Generator[] } {
  const walls: Wall[] = [];
  const idMap = new Map<number, number>();
  for (const sw of core.walls) {
    const polygons = sw.polygons.filter((poly) => poly.length >= 3);
    if (polygons.length === 0) continue;
    // `=== true` rather than a plain read: a report written before the flag
    // existed simply has no field there, and that is an ordinary wall.
    const wall = makeWall(polygons, { color: sw.color, isBorder: sw.isBorder === true });
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
      spawned: a.spawned === true,
    };
  });

  const labels = (core.labels ?? [])
    .filter((l) => typeof l.text === 'string' && l.text !== '' && Array.isArray(l.at))
    // Fresh ids like the walls, and a style clamped like a slider's: a label out
    // of a link is untrusted input, and makeLabel holds both numbers to the same
    // ranges the controls offer. A payload missing either is one written by
    // hand, and takes the default rather than a zero-height or weightless word.
    .map((l) => makeLabel([l.at[0], l.at[1]], l.text, {
      size: number(l.size, DEFAULT_SETTINGS.labelSize),
      weight: number(l.weight, DEFAULT_SETTINGS.labelWeight),
    }));

  // Goals repointed the way an agent's is, and for the same reason: the ids in
  // the payload are not the ids this map will have. A generator whose goal did
  // not survive is simply one that is not pinned anywhere, which is a state the
  // map already has a meaning for -- it stands there and emits nothing.
  const generators = (core.generators ?? [])
    .filter((g) => Array.isArray(g.at) && g.at.length === 2)
    .map((g) => {
      const made = makeGenerator(
        [g.at[0], g.at[1]],
        number(g.rate, DEFAULT_SETTINGS.generatorRate),
      );
      const goal = idMap.get(g.goal) ?? -1;
      made.goal = goal;
      // Unpinned it keeps the white makeGenerator gave it; pinned it wears its
      // goal's colour, as everything else headed for a goal does.
      if (goal >= 0 && g.color) made.color = g.color;
      return made;
    });

  return { walls, agents, labels, generators };
}
