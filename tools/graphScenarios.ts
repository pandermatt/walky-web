/**
 * Maps for the graph-only fixtures: geometry in, visibility graph out, no
 * simulation at all.
 *
 * These are the highest-value five fixtures in the set and they cost the least.
 * A geometry bug and a behaviour bug are indistinguishable once a crowd is
 * walking -- both look like "everybody went the wrong way" -- so pinning the
 * graph first halves the space a divergence can be hiding in. Nothing below
 * steps a single tick.
 *
 * The shapes are chosen for what convexDecompose does to them: a rectangle
 * stays one part, an L becomes two, a U becomes three. The U is the one that
 * mattered historically -- one hull per wall made a goal inside it unreachable,
 * because every node was discarded for sitting inside the U's own hull.
 */
import { makeWall, rectanglePolygon, type Wall } from '../src/state/model.ts';
import type { Point } from '../src/sim/geometry.ts';
import type { RGB } from '../src/palette.ts';
import { R } from './traceScenarios.ts';

const SLATE: RGB = [110, 120, 160];
const AMBER: RGB = [255, 200, 0];

export interface GraphScenario {
  name: string;
  proves: string;
  build(): Wall[];
}

const bar = (a: Point, b: Point) => rectanglePolygon(a, b);

/** A closed polygon written out longhand, for the shapes a rectangle cannot make. */
const poly = (...pts: Point[]): Point[] => pts;

export const GRAPH_SCENARIOS: GraphScenario[] = [
  {
    name: 'graph-rect',
    proves: 'the simplest case: one convex part, four expanded corners, one goal',
    build: () => {
      const block = makeWall([bar([-200, -120], [200, 120])], { color: SLATE });
      const goal = makeWall([bar([500, -60], [600, 60])], { color: AMBER });
      goal.isGoal = true;
      return [block, goal];
    },
  },
  {
    name: 'graph-ell',
    proves: 'convexDecompose splitting one concave shape into two parts',
    build: () => {
      const ell = makeWall([poly(
        [-200, -200], [100, -200], [100, -40], [-40, -40], [-40, 200], [-200, 200],
      )], { color: SLATE });
      const goal = makeWall([bar([400, -60], [500, 60])], { color: AMBER });
      goal.isGoal = true;
      return [ell, goal];
    },
  },
  {
    name: 'graph-yu',
    proves: 'three parts, and a goal inside the cavity that one hull per wall made unreachable',
    build: () => {
      const yu = makeWall([poly(
        [-300, -240], [-160, -240], [-160, 80], [160, 80], [160, -240], [300, -240],
        [300, 240], [-300, 240],
      )], { color: SLATE });
      // Sitting in the mouth of the U: reachable only because the parts are
      // decomposed rather than hulled as one.
      const goal = makeWall([bar([-40, -160], [40, -100])], { color: AMBER });
      goal.isGoal = true;
      return [yu, goal];
    },
  },
  {
    name: 'graph-overlap',
    proves: 'two overlapping walls kept as separate obstacles, and the shell broad phase',
    build: () => {
      // Overlapping deliberately: the original merged these into one wall, and
      // a map-sized shell rejects nothing, so every visibility test walked
      // every part.
      const a = makeWall([bar([-300, -100], [0, 100])], { color: SLATE });
      const b = makeWall([bar([-60, -260], [140, 60])], { color: SLATE });
      const goal = makeWall([bar([400, -60], [500, 60])], { color: AMBER });
      goal.isGoal = true;
      return [a, b, goal];
    },
  },
  {
    name: 'graph-two-goals',
    proves: 'one routing field per goal, and the order they are inserted in',
    build: () => {
      // The insertion order here is what navigation.ts:148 round-robins over.
      // Swift's Dictionary would not preserve it; this fixture is where that
      // shows up as a wrong number rather than as odd behaviour 600 ticks in.
      const top = makeWall([bar([-500, -300], [500, -240])], { color: SLATE });
      const bottom = makeWall([bar([-500, 240], [500, 300])], { color: SLATE });
      const island = makeWall([bar([-80, -120], [80, 120])], { color: SLATE });
      const east = makeWall([bar([420, -60], [500, 60])], { color: AMBER });
      const west = makeWall([bar([-500, -60], [-420, 60])], { color: AMBER });
      east.isGoal = true;
      west.isGoal = true;
      return [top, bottom, island, east, west];
    },
  },
];

export { R };
