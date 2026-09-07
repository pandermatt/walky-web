/**
 * The scenarios the codec fixtures are made of.
 *
 * A module rather than a literal inside the generator, for the same reason
 * `traceScenarios.ts` is one: the fixture and the test that guards it must
 * describe the same worlds, and two copies of a scenario are two things that can
 * drift apart while both look right.
 *
 * They deliberately reach the corners: negative coordinates (Math.round is
 * half-up and Swift's .rounded() is not), a colour that repeats and one that
 * does not, an origin that differs from the position, a goal naming no wall, a
 * label with astral-plane text, and every optional block both present and absent.
 */
import { DEFAULT_SETTINGS, type Settings } from '../src/state/model.ts';
import { SCENARIO_VERSION, type ScenarioCore } from '../src/state/scenario.ts';

const view = (targetX: number, targetY: number, zoomLevel: number) => ({ targetX, targetY, zoomLevel });

function core(over: Partial<ScenarioCore> = {}): ScenarioCore {
  return {
    version: SCENARIO_VERSION,
    settings: { ...DEFAULT_SETTINGS } as Settings,
    view: view(0, 0, 0),
    walls: [],
    agents: [],
    labels: [],
    generators: [],
    ...over,
  };
}

export const FIXTURES: Record<string, ScenarioCore> = {
  /** The floor: nothing on the map at all. */
  empty: core(),

  /** Defaults moved off their defaults, including the fractional one. */
  settings: core({
    settings: {
      ...DEFAULT_SETTINGS,
      showVisibleLines: true, showLineToTarget: true, showConvexHull: true,
      showConvexParts: true, showPersonalSpace: true, showDebug: true, sound: false,
      speed: 2.15, pedestrianRadius: 21, personalSpace: 5, brushSize: 4,
      borderThickness: 33,
    } as Settings,
    view: view(-1234.5, 987.25, -12.5),
  }),

  /**
   * Walls with negative vertices, which is where Math.round's half-up rule bites:
   * Math.round(-1.5) is -1 and Swift's .rounded() gives -2.
   */
  walls: core({
    view: view(-560.0625, -209.9375, 3.25),
    walls: [
      { id: 7, polygons: [[[-560, -209], [-540, -209], [-540, -189], [-560, -189]]],
        color: [255, 200, 0], isGoal: false, isBorder: false },
      { id: 8, polygons: [[[-1.5, -2.5], [0.5, -2.5], [0.5, 1.5]]],
        color: [41, 214, 168], isGoal: true, isBorder: false },
      { id: 40, polygons: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[20, 20], [30, 20], [30, 30]]],
        color: [11, 34, 64], isGoal: false, isBorder: true },
    ],
  }),

  /** Every agent bit, and a goal index naming a wall that is not there. */
  agents: core({
    walls: [
      { id: 3, polygons: [[[0, 0], [8, 0], [8, 8], [0, 8]]],
        color: [196, 25, 192], isGoal: true, isBorder: false },
    ],
    agents: [
      // Unmoved, so no origin on the wire; first colour, so it is written.
      { x: 100, y: 100, originX: 100, originY: 100, goal: 3, arrived: false, color: [255, 200, 0] },
      // Same colour again -- the repeat bit.
      { x: 104, y: 100, originX: 104, originY: 100, goal: 3, arrived: false, color: [255, 200, 0] },
      // Moved, arrived, spawned, and a new colour.
      { x: -50, y: -50, originX: 120, originY: 130, goal: 3, arrived: true,
        color: [66, 158, 214], spawned: true },
      // Unassigned: goal -1 rides as index 0 and comes back as -1.
      { x: 0, y: 0, originX: 0, originY: 0, goal: -1, arrived: false, color: [214, 66, 39] },
    ],
  }),

  /** Both optional blocks, and text that is not ASCII. */
  labelsAndGenerators: core({
    walls: [
      { id: 1, polygons: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
        color: [168, 214, 66], isGoal: true, isBorder: false },
    ],
    labels: [
      { at: [0, 0], text: 'Hauptbahnhof', size: 28, weight: 1000 },
      { at: [-300, 450], text: 'Ausgang → \u{1F6B6}‍♂️', size: 40, weight: 250 },
    ],
    generators: [
      { at: [10, 10], rate: 4, goal: 1, color: [255, 200, 0] },
      { at: [-90, 12], rate: 20, goal: -1, color: [41, 214, 168] },
    ],
  }),
};

