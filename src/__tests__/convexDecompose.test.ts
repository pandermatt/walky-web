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
