import { describe, it, expect } from 'vitest';
import { groupWalls } from '../state/groups';
import { makeWall, rectanglePolygon, borderFrame } from '../state/model';
import { pointInPolygon, type Point } from '../sim/geometry';
import { monotoneChainHull } from '../sim/convexHull';

describe('groupWalls', () => {
  it('puts overlapping shapes in one group', () => {
    const a = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const b = makeWall([rectanglePolygon([80, 80], [180, 180])]);
    const groups = groupWalls([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([a.id, b.id].sort((x, y) => x - y));
  });

  it('puts shapes that merely touch in one group', () => {
    const a = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const b = makeWall([rectanglePolygon([100, 0], [200, 100])]);
    expect(groupWalls([a, b])).toHaveLength(1);
  });

  it('keeps shapes with a clear gap apart', () => {
    const a = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const b = makeWall([rectanglePolygon([140, 0], [240, 100])]);
    expect(groupWalls([a, b])).toHaveLength(2);
  });

  it('is transitive: A touches B, B touches C, all one group', () => {
    const a = makeWall([rectanglePolygon([0, 0], [100, 50])]);
    const b = makeWall([rectanglePolygon([90, 0], [190, 50])]);
    const c = makeWall([rectanglePolygon([180, 0], [280, 50])]);
    const groups = groupWalls([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toHaveLength(3);
    // A and C do not touch each other; they are joined only through B.
    expect(groupWalls([a, c])).toHaveLength(2);
  });

  it('hull contains every point of every member', () => {
    const a = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const b = makeWall([rectanglePolygon([80, 80], [180, 180])]);
    const [group] = groupWalls([a, b]);
    for (const wall of [a, b]) {
      for (const p of wall.polygons.flat()) {
        const inside = pointInPolygon(group.hull, p);
        const onEdge = group.hull.some((h, i) => {
          const q = group.hull[(i + 1) % group.hull.length];
          const cross = (q[0] - h[0]) * (p[1] - h[1]) - (q[1] - h[1]) * (p[0] - h[0]);
          return Math.abs(cross) < 1e-6;
        });
        expect(inside || onEdge).toBe(true);
      }
    }
  });

  it('groups the bars of a border frame as one, since it is one wall', () => {
    const frame = makeWall(borderFrame([0, 0] as Point, [400, 300] as Point, 12));
    expect(groupWalls([frame])).toHaveLength(1);
  });

  it('handles an empty map', () => {
    expect(groupWalls([])).toEqual([]);
  });

  it('leaves a wall that opts out of hulling with no outline of its own', () => {
    const freehand = makeWall([rectanglePolygon([0, 0], [100, 100])], { hulled: false });
    expect(freehand.hull).toEqual([]);
    // Nothing in the group to hull, so there is no outline to return.
    expect(groupWalls([freehand])).toEqual([]);
  });

  it('groups a wall that opts out, but keeps it out of the hull', () => {
    const solid = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const freehand = makeWall([rectanglePolygon([90, 90], [400, 400])], { hulled: false });
    const groups = groupWalls([solid, freehand]);
    expect(groups).toHaveLength(1);
    // Both are members -- they touch -- but the outline is the rectangle's alone.
    expect(groups[0].wallIds).toEqual([solid.id, freehand.id].sort((a, b) => a - b));
    expect(groups[0].hullWallIds).toEqual([solid.id]);
    expect(groups[0].hull).toEqual(monotoneChainHull(solid.polygons.flat()));
  });

  it('lets a wall that opts out join two shapes under one outline', () => {
    const left = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const right = makeWall([rectanglePolygon([300, 0], [400, 100])]);
    // A traced shape bridging the gap, reaching well below both rectangles.
    const bridge = makeWall([[[90, 40], [310, 40], [310, 400], [90, 400]] as Point[]],
      { hulled: false });

    expect(groupWalls([left, right])).toHaveLength(2);
    const [group] = groupWalls([left, right, bridge]);
    expect(group.wallIds).toHaveLength(3);
    expect(group.hullWallIds).toEqual([left.id, right.id].sort((a, b) => a - b));
    // One hull over both rectangles, and it stops where they do: the bridge's
    // own reach down to y = 400 is not part of it.
    expect(group.hull).toEqual(monotoneChainHull([
      ...left.polygons.flat(), ...right.polygons.flat(),
    ]));
    expect(Math.max(...group.hull.map((p) => p[1]))).toBe(100);
  });
});
