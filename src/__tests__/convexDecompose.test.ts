import { describe, it, expect } from 'vitest';
import { convexDecompose, isConvex } from '../sim/convexDecompose';
import { signedArea2, type Point } from '../sim/geometry';
import { buildVisibilityGraph, nodesOfWall } from '../sim/visibilityGraph';
import { dijkstra } from '../sim/dijkstra';
import { Navigation } from '../sim/navigation';
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { makeWall, rectanglePolygon } from '../state/model';

const area = (p: Point[]) => Math.abs(signedArea2(p)) / 2;

/** Interior angles of a ring, in degrees. */
function interiorAngles(poly: Point[]): number[] {
  return poly.map((at, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const ux = prev[0] - at[0], uy = prev[1] - at[1];
    const vx = next[0] - at[0], vy = next[1] - at[1];
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
  });
}

/** A blob off a real map, traced freehand: 25 vertices, none of them sharp. */
const TRACED: Point[] = [
  [-91, -204], [-97, -198], [-116, -155], [-116, -131], [-90, -115], [-33, -94],
  [-23, -87], [-15, -68], [-14, -52], [-27, -23], [-27, 1], [-15, 20], [7, 18],
  [43, 42], [80, 51], [91, 21], [90, -46], [84, -64], [70, -71], [60, -87],
  [57, -110], [61, -119], [80, -137], [81, -157], [66, -173],
];

const U: Point[] = [[0, 0], [200, 0], [200, 60], [60, 60], [60, 200], [200, 200], [200, 260], [0, 260]];
const L: Point[] = [[0, 0], [200, 0], [200, 80], [80, 80], [80, 240], [0, 240]];

describe('convexDecompose', () => {
  it('leaves a convex polygon alone', () => {
    const square = rectanglePolygon([0, 0], [100, 100]);
    expect(convexDecompose(square)).toHaveLength(1);
    expect(convexDecompose(square)[0]).toHaveLength(4);
  });

  it('splits concave shapes into convex parts that preserve the area', () => {
    for (const shape of [U, L]) {
      const parts = convexDecompose(shape);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(isConvex(part)).toBe(true);
      const total = parts.reduce((s, p) => s + area(p), 0);
      expect(total).toBeCloseTo(area(shape), 4);
    }
  });

  it('merges triangles back into as few parts as it can', () => {
    // A U needs only three rectangles; ear clipping alone would leave six triangles.
    expect(convexDecompose(U).length).toBeLessThanOrEqual(4);
  });

  it('handles degenerate input without spinning', () => {
    expect(convexDecompose([])).toEqual([]);
    expect(convexDecompose([[0, 0], [1, 1]])).toEqual([]);
    expect(convexDecompose([[0, 0], [0, 0], [0, 0]])).toEqual([]);
  });
});

describe('a goal inside a U-shaped wall', () => {
  it('is reachable, where one hull per wall made it unreachable', () => {
    const u = makeWall([U]);
    const goal = makeWall([rectanglePolygon([110, 110], [160, 150])]);
    goal.isGoal = true;

    const g = buildVisibilityGraph([u, goal], 13);
    const sources = nodesOfWall(g, goal.id);
    expect(sources.length).toBeGreaterThan(0);

    const { dist } = dijkstra(g.csr, sources);
    expect([...dist].every(Number.isFinite)).toBe(true);
  });

  it('a pedestrian outside walks into the cavity and arrives', () => {
    const u = makeWall([U]);
    const goal = makeWall([rectanglePolygon([110, 110], [160, 150])]);
    goal.isGoal = true;

    const nav = new Navigation();
    nav.rebuild([u, goal], 13);
    const agents = new Agents();
    const hash = new SpatialHash();
    // Start well clear of the U, on the open side.
    const i = agents.add([400, 130]);
    agents.setGoal(i, goal.id, goal.color);

    for (let t = 0; t < 4000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 4, 13, 30);
    }
    expect(agents.arrived[i]).toBe(1);
  });

  it('still refuses to walk through the U\'s solid arms', () => {
    const u = makeWall([U]);
    const goal = makeWall([rectanglePolygon([110, 110], [160, 150])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([u, goal], 13);
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([400, 130]);
    agents.setGoal(i, goal.id, goal.color);

    for (let t = 0; t < 4000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 4, 13, 30);
      const x = agents.x[i], y = agents.y[i];
      // The top arm spans x 0..200, y 0..60; never inside it.
      expect(x > 0 && x < 200 && y > 0 && y < 60).toBe(false);
    }
    expect(agents.arrived[i]).toBe(1);
  });
});

describe('decomposing a traced outline', () => {
  const parts = convexDecompose(TRACED);

  it('tiles the polygon exactly', () => {
    expect(parts.every(isConvex)).toBe(true);
    const sum = parts.reduce((total, p) => total + area(p), 0);
    expect(sum).toBeCloseTo(area(TRACED), 6);
  });

  it('does not invent corners far sharper than the outline has', () => {
    // The outline's own sharpest corner is 96 degrees. Ear clipping cannot always
    // match that, but picking the roundest ear keeps it in the same world: taking
    // the first ear instead produced 13 pieces with corners under 2 degrees, which
    // expandPolygon then threw hundreds of units across the map.
    const sharpest = Math.min(...parts.flatMap(interiorAngles));
    expect(Math.min(...interiorAngles(TRACED))).toBeGreaterThan(90);
    expect(sharpest).toBeGreaterThan(5);
    expect(parts.length).toBeLessThanOrEqual(9);
  });
});
