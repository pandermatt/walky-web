import { describe, it, expect } from 'vitest';
import { buildVisibilityGraph, isVisible, nodesOfWall, NODE_MARGIN } from '../sim/visibilityGraph';
import { dijkstra } from '../sim/dijkstra';
import { makeWall, rectanglePolygon } from '../state/model';
import { distance, pointInPolygon, type Point } from '../sim/geometry';

const RADIUS = 13;

describe('isVisible', () => {
  it('blocks a segment that passes through a building', () => {
    const wall = makeWall([rectanglePolygon([100, 100], [200, 200])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    expect(isVisible([50, 150], [250, 150], g)).toBe(false);
    expect(isVisible([50, 50], [250, 50], g)).toBe(true);
  });

  it('rejects a chord across the same hull even though it crosses no edge', () => {
    const wall = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    // Opposite corners of the expanded hull: the chord touches only at its ends.
    const [a, , c] = g.obstacles[0].hull;
    expect(isVisible(a, c, g)).toBe(false);
  });

  it('allows a walk along a hull edge', () => {
    const wall = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    const hull = g.obstacles[0].hull;
    expect(isVisible(hull[0], hull[1], g)).toBe(true);
  });
});

describe('buildVisibilityGraph', () => {
  it('puts nodes clear of the wall, with room to stand', () => {
    const wall = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    expect(g.nodes.length).toBe(4);
    // Nodes sit on a ring slightly outside the blocking hull, so each corner is
    // (radius + margin) * sqrt(2) diagonally out.
    const corner = g.nodes.find((p) => p[0] < 0 && p[1] < 0)!;
    expect(distance(corner, [0, 0])).toBeCloseTo((RADIUS + NODE_MARGIN) * Math.SQRT2, 4);
  });

  it('places every node somewhere a pedestrian can legally stand', () => {
    // The reason for the margin: a node exactly on the blocking hull is a spot
    // point-in-polygon cannot decide, so pedestrians stalled on their own
    // waypoint instead of passing through it.
    const walls = [
      makeWall([rectanglePolygon([0, 0], [100, 100])]),
      makeWall([rectanglePolygon([200, -40], [260, 160])]),
      makeWall([[[300, 0], [500, 0], [500, 60], [360, 60], [360, 200], [500, 200], [500, 260], [300, 260]]]),
    ];
    const g = buildVisibilityGraph(walls, RADIUS);
    expect(g.nodes.length).toBeGreaterThan(0);
    for (const node of g.nodes) {
      for (const ob of g.obstacles) {
        expect(pointInPolygon(ob.hull, node)).toBe(false);
      }
      // And the integer cell a pedestrian would actually occupy is legal too.
      const snapped: Point = [Math.round(node[0]), Math.round(node[1])];
      for (const ob of g.obstacles) {
        expect(pointInPolygon(ob.hull, snapped)).toBe(false);
      }
    }
  });

  it('drops corners buried inside another building', () => {
    // Two heavily overlapping squares: the inner corners are unusable.
    const a = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const b = makeWall([rectanglePolygon([20, 20], [80, 80])]);
    const g = buildVisibilityGraph([a, b], RADIUS);
    expect(nodesOfWall(g, b.id)).toHaveLength(0);
    expect(nodesOfWall(g, a.id)).toHaveLength(4);
  });

  it('connects the corners of one building into a ring', () => {
    const wall = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    // Every corner reaches exactly its two ring neighbours.
    for (let i = 0; i < g.csr.nodeCount; i++) {
      expect(g.csr.offsets[i + 1] - g.csr.offsets[i]).toBe(2);
    }
  });

  it('routes around an obstacle rather than through it, and beats the straight line', () => {
    // A wall squarely between start and goal.
    const blocker = makeWall([rectanglePolygon([100, 0], [160, 200])]);
    const goal = makeWall([rectanglePolygon([260, 80], [320, 140])]);
    const g = buildVisibilityGraph([blocker, goal], RADIUS);

    const sources = nodesOfWall(g, goal.id);
    expect(sources.length).toBeGreaterThan(0);
    const { dist } = dijkstra(g.csr, sources);

    // Every corner of the blocker can reach the goal.
    for (const n of nodesOfWall(g, blocker.id)) {
      expect(dist[n]).toBeLessThan(Infinity);
    }
    // Going around costs more than the blocked straight line would have.
    const straight = distance([50, 100] as Point, [290, 110] as Point);
    const viaCorner = Math.min(...nodesOfWall(g, blocker.id).map(
      (n) => distance([50, 100] as Point, g.nodes[n]) + dist[n]));
    expect(viaCorner).toBeGreaterThan(straight);
  });

  it('marks a walled-off goal as unreachable', () => {
    // A goal fully enclosed by a ring of four walls leaves no way in.
    const goal = makeWall([rectanglePolygon([100, 100], [140, 140])]);
    const ring = [
      makeWall([rectanglePolygon([40, 40], [200, 60])]),
      makeWall([rectanglePolygon([40, 180], [200, 200])]),
      makeWall([rectanglePolygon([40, 40], [60, 200])]),
      makeWall([rectanglePolygon([180, 40], [200, 200])]),
    ];
    const g = buildVisibilityGraph([goal, ...ring], RADIUS);
    const { dist } = dijkstra(g.csr, nodesOfWall(g, goal.id));
    // Nodes on the far side of the ring cannot reach the goal.
    const outside = g.nodes
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p[0] < 30 || p[0] > 210 || p[1] < 30 || p[1] > 210);
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every(({ i }) => dist[i] === Infinity)).toBe(true);
  });
});

describe('navigation regression: walking along a wall', () => {
  it('lets an agent standing on a hull corner see the next corner', () => {
    // The segment between two adjacent expanded-hull corners runs exactly along
    // the hull edge, so its midpoint lies on the boundary. Ray casting there is
    // ambiguous; without the boundary exemption agents park on the corner.
    const wall = makeWall([rectanglePolygon([100, -150], [160, 150])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    const hull = g.obstacles[0].hull;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      expect(isVisible(a, b, g)).toBe(true);
    }
  });

  it('still refuses the diagonal across that same hull', () => {
    const wall = makeWall([rectanglePolygon([100, -150], [160, 150])]);
    const g = buildVisibilityGraph([wall], RADIUS);
    const hull = g.obstacles[0].hull;
    expect(isVisible(hull[0], hull[2], g)).toBe(false);
  });
});
