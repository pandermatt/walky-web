import type { RGB } from '../palette';
import type { Point } from '../sim/geometry';
import type { Settings, Tree, Wall } from './model';

/**
 * A snapshot of everything on the map, as plain JSON.
 *
 * Exists so a scenario can be handed to someone else verbatim -- notably to
 * reproduce a case where pedestrians get stuck, which depends on the exact
 * positions, goals and settings involved and is otherwise near-impossible to
 * describe. Also the basis for saving and loading.
 */
export const SCENARIO_VERSION = 1;

export interface SerializedAgent {
  x: number;
  y: number;
  originX: number;
  originY: number;
  goal: number;
  arrived: boolean;
  /** Set when the pedestrian has no route: the thing worth looking at. */
  stuck: boolean;
}

export interface SerializedWall {
  id: number;
  polygons: Point[][];
  color: RGB;
  isGoal: boolean;
  /** False for shapes left out of the convex hull calculation; see Wall.hulled. */
  hulled: boolean;
}

export interface Scenario {
  version: number;
  created: string;
  settings: Settings;
  view: { targetX: number; targetY: number; zoomLevel: number };
  walls: SerializedWall[];
  trees: { x: number; y: number; radius: number }[];
  agents: SerializedAgent[];
  /** Quick read on the state of the run, so a report is legible at a glance. */
  summary: {
    walls: number;
    goals: number;
    agents: number;
    arrived: number;
    stuck: number;
  };
}

export function serializeScenario(input: {
  settings: Settings;
  view: { targetX: number; targetY: number; zoomLevel: number };
  walls: Wall[];
  trees: Tree[];
  agents: SerializedAgent[];
}): Scenario {
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    version: SCENARIO_VERSION,
    created: new Date().toISOString(),
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
      hulled: w.hulled,
    })),
    trees: input.trees.map((t) => ({ x: round(t.position[0]), y: round(t.position[1]), radius: t.radius })),
    agents: input.agents.map((a) => ({
      x: round(a.x),
      y: round(a.y),
      originX: round(a.originX),
      originY: round(a.originY),
      goal: a.goal,
      arrived: a.arrived,
      stuck: a.stuck,
    })),
    summary: {
      walls: input.walls.length,
      goals: input.walls.filter((w) => w.isGoal).length,
      agents: input.agents.length,
      arrived: input.agents.filter((a) => a.arrived).length,
      stuck: input.agents.filter((a) => a.stuck).length,
    },
  };
}

export function scenarioToJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}
