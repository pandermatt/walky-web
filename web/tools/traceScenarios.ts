/**
 * The worlds the golden traces are recorded from, as data.
 *
 * One module, imported by both the generator (tools/goldenTrace.ts) and the
 * ratchet (src/__tests__/goldenTrace.test.ts), so a fixture and the test that
 * guards it cannot come to describe different worlds. The Swift port builds
 * from the emitted manifest rather than from a transcription of this file --
 * hand-copying a scenario into Swift is exactly where two ports silently
 * disagree about the *input* while arguing about the output.
 *
 * Every colour is pinned. `makeWall` and `Agents.add` both default their colour
 * to `randomBrightColor()`, which is the one place `Math.random` reaches into
 * the model (palette.ts:28) -- the determinism invariant covers decisions, not
 * decoration. Left to the default, a fixture would differ from itself run to
 * run in the one field nothing depends on.
 */
import { Agents } from '../src/sim/agents.ts';
import { SpatialHash } from '../src/sim/spatialHash.ts';
import { Navigation } from '../src/sim/navigation.ts';
import { makeWall, rectanglePolygon, type Wall } from '../src/state/model.ts';
import { RECOST_TICKS } from '../src/sim/navigation.ts';
import type { Point } from '../src/sim/geometry.ts';
import type { RGB } from '../src/palette.ts';

/** The radius every scenario runs at: AbstractPedestrian's default. */
export const R = 13;

export interface WallSpec {
  /** Axis-aligned bars, which is all any of these maps needs. */
  rects: [Point, Point][];
  color: RGB;
  isGoal?: boolean;
}

export interface BlockSpec {
  /** Index into `walls` of the goal this block walks to. */
  goal: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  pitch: number;
}

export interface ScenarioSpec {
  name: string;
  /** What this fixture is for, carried into the manifest. */
  proves: string;
  ticks: number;
  /** Pixels per tick, as handed to `Agents.step`. */
  speed: number;
  personalSpace: number;
  walls: WallSpec[];
  crowd: BlockSpec[];
}

const rect = (a: Point, b: Point): [Point, Point] => [a, b];

// Colours are arbitrary but fixed. Distinct per wall so a rendered fixture is
// readable later, and never the default, which would be random.
const TEAL: RGB = [0, 190, 200];
const MAGENTA: RGB = [196, 25, 192];
const AMBER: RGB = [255, 200, 0];
const LIME: RGB = [150, 220, 60];
const SLATE: RGB = [110, 120, 160];

export const SCENARIOS: ScenarioSpec[] = [
  {
    name: 'crush',
    proves: 'carryStep, the pressure and push chain, CARRY_SALT',
    // determinism.test.ts:42 runCrush -- a bottleneck that provably carries people.
    ticks: 400,
    speed: 4,
    personalSpace: 60,
    walls: [
      { rects: [rect([0, -500], [40, -35])], color: SLATE },
      { rects: [rect([0, 35], [40, 500])], color: SLATE },
      { rects: [rect([260, -40], [340, 40])], color: AMBER, isGoal: true },
    ],
    crowd: [{ goal: 2, cols: 14, rows: 12, x0: -560, y0: -209, pitch: 38 }],
  },
  {
    name: 'stuck',
    proves: 'escapeStep tie-breaks and randomStep -- buried in a wall, and sealed in a room',
    // determinism.test.ts:62 runStuck. Placed by hand rather than as a block.
    ticks: 300,
    speed: 4,
    personalSpace: 40,
    walls: [
      { rects: [rect([-100, -100], [100, 100])], color: SLATE },
      {
        rects: [
          rect([300, -100], [500, -80]), rect([300, 80], [500, 100]),
          rect([300, -100], [320, 100]), rect([480, -100], [500, 100]),
        ],
        color: SLATE,
      },
      { rects: [rect([700, -40], [780, 40])], color: AMBER, isGoal: true },
    ],
    // One buried inside the slab, one sealed in the box. 1x1 blocks.
    crowd: [
      { goal: 2, cols: 1, rows: 1, x0: 0, y0: 0, pitch: 1 },
      { goal: 2, cols: 1, rows: 1, x0: 400, y0: 0, pitch: 1 },
    ],
  },
  {
    name: 'corridor-40',
    proves: 'the ordinary walk, at the default personal space',
    // crowd.test.ts:87 walkCorridor.
    ticks: 900,
    speed: 4,
    personalSpace: 40,
    walls: [
      { rects: [rect([-500, -260], [500, -200])], color: SLATE },
      { rects: [rect([-500, 200], [500, 260])], color: SLATE },
      { rects: [rect([420, -60], [500, 60])], color: AMBER, isGoal: true },
    ],
    crowd: [{ goal: 2, cols: 10, rows: 8, x0: -420, y0: -119, pitch: 34 }],
  },
  {
    name: 'corridor-90',
    proves: 'the same walk with the preferred space more than doubled',
    ticks: 900,
    speed: 4,
    personalSpace: 90,
    walls: [
      { rects: [rect([-500, -260], [500, -200])], color: SLATE },
      { rects: [rect([-500, 200], [500, 260])], color: SLATE },
      { rects: [rect([420, -60], [500, 60])], color: AMBER, isGoal: true },
    ],
    crowd: [{ goal: 2, cols: 10, rows: 8, x0: -420, y0: -119, pitch: 34 }],
  },
  {
    name: 'counterflow',
    proves: 'oncoming, W_SIDE, and which side a stream settles on',
    // crowd.test.ts:255, at shift 0. The least reproducible thing the model
    // does -- a pixel of placement swings arrivals from 12 to 102 -- which is
    // precisely why it belongs in a bit-exact fixture.
    ticks: 900,
    speed: 4,
    personalSpace: 40,
    walls: [
      { rects: [rect([-700, -220], [700, -170])], color: SLATE },
      { rects: [rect([-700, 170], [700, 220])], color: SLATE },
      { rects: [rect([620, -160], [700, 160])], color: TEAL, isGoal: true },
      { rects: [rect([-700, -160], [-620, 160])], color: MAGENTA, isGoal: true },
    ],
    crowd: [
      { goal: 2, cols: 7, rows: 8, x0: -560, y0: -140, pitch: 34 },
      // Westbound, laid right to left: a negative pitch walks the block back.
      { goal: 3, cols: 7, rows: 8, x0: 560, y0: -140, pitch: -34 },
    ],
  },
  {
    name: 'party',
    proves: 'partyOf and the W_PARTY gradient term',
    // crowd.test.ts:739 -- the corridor again, read for who walks with whom.
    ticks: 600,
    speed: 4,
    personalSpace: 40,
    walls: [
      { rects: [rect([-500, -260], [500, -200])], color: SLATE },
      { rects: [rect([-500, 200], [500, 260])], color: SLATE },
      { rects: [rect([420, -60], [500, 60])], color: AMBER, isGoal: true },
    ],
    crowd: [{ goal: 2, cols: 10, rows: 8, x0: -420, y0: -119, pitch: 34 }],
  },
  {
    name: 'congestion',
    proves: 'recost, edgeSlow, and the goal round-robin order (navigation.ts:148)',
    // Two ways around a central block, one of them jammed by the crowd's own
    // weight. Runs past 3x RECOST_TICKS so the re-pricing has fired repeatedly
    // -- which is what makes this the fixture that catches Swift's Dictionary
    // reordering the round-robin.
    ticks: 800,
    speed: 4,
    personalSpace: 40,
    walls: [
      { rects: [rect([-600, -400], [600, -340])], color: SLATE },
      { rects: [rect([-600, 340], [600, 400])], color: SLATE },
      // The island, leaving a wide north route and a narrow south one.
      { rects: [rect([-120, -180], [120, 240])], color: SLATE },
      { rects: [rect([500, -80], [600, 80])], color: AMBER, isGoal: true },
      { rects: [rect([-600, -80], [-500, 80])], color: LIME, isGoal: true },
    ],
    crowd: [
      { goal: 3, cols: 10, rows: 9, x0: -460, y0: -160, pitch: 34 },
      { goal: 4, cols: 6, rows: 6, x0: 420, y0: -90, pitch: 34 },
    ],
  },
];

export interface BuiltScenario {
  spec: ScenarioSpec;
  walls: Wall[];
  nav: Navigation;
  agents: Agents;
  hash: SpatialHash;
  /**
   * One tick, in the order App.stepOnce takes it.
   *
   * The recost is the reason this exists rather than the generator simply
   * calling `agents.step`. `Navigation.recost` is driven from app.ts:1751 --
   * `simTicks % RECOST_TICKS` -- and never from inside the model, so a fixture
   * recorded from `agents.step` alone would never re-price a single edge, and
   * the congestion scenario would silently prove nothing. The hash it reads is
   * the one `agents.step` just built, one tick fresh, exactly as in the app.
   *
   * Everything else stepOnce does -- metrics, arrivals, removing spawned
   * pedestrians -- either cannot move anybody or has no generators to run in
   * these scenarios.
   */
  step(): void;
}

/**
 * Builds a scenario's world.
 *
 * Wall ids come from a module-level counter in model.ts, so they depend on how
 * many walls this process has already made. The manifest records the resolved
 * ids rather than assuming them, and the Swift side reads them from there --
 * `Navigation` keys its routing fields by id, and the order those ids were
 * inserted in decides the recost round-robin.
 */
export function buildScenario(spec: ScenarioSpec): BuiltScenario {
  const walls = spec.walls.map((w) => {
    const wall = makeWall(w.rects.map(([a, b]) => rectanglePolygon(a, b)), { color: w.color });
    if (w.isGoal) wall.isGoal = true;
    return wall;
  });

  const nav = new Navigation();
  nav.rebuild(walls, R);

  const agents = new Agents();
  const hash = new SpatialHash();
  for (const b of spec.crowd) {
    const goal = walls[b.goal];
    for (let i = 0; i < b.cols; i++) {
      for (let j = 0; j < b.rows; j++) {
        // The colour is passed rather than defaulted: the default is random.
        const k = agents.add([b.x0 + i * b.pitch, b.y0 + j * Math.abs(b.pitch)], goal.color);
        agents.setGoal(k, goal.id, goal.color);
      }
    }
  }

  let simTicks = 0;
  const step = () => {
    agents.step(nav, hash, spec.speed, R, spec.personalSpace);
    simTicks++;
    if (simTicks % RECOST_TICKS === 0) {
      nav.recost(hash, agents.x, agents.y, agents.count);
    }
  };

  return { spec, walls, nav, agents, hash, step };
}
