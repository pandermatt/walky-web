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

  it('leaves a shape that is not outlined alone without an outline', () => {
    const trace: Point[] = [[0, 0], [100, 0], [100, 100], [40, 60], [0, 100]];
    const freehand = makeWall([trace], { outlinedAlone: false });
    // Touching nothing, there is no group for the outline to summarise.
    expect(groupWalls([freehand])).toEqual([]);
  });

  it('outlines it once it touches something, points and all', () => {
    const solid = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const freehand = makeWall([rectanglePolygon([90, 90], [400, 400])], { outlinedAlone: false });
    const groups = groupWalls([solid, freehand]);

    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([solid.id, freehand.id].sort((a, b) => a - b));
    // The outline is the group's, so the trace shapes it like any other member.
    expect(groups[0].hull).toEqual(monotoneChainHull([
      ...solid.polygons.flat(), ...freehand.polygons.flat(),
    ]));
  });

  it('outlines two traces that touch each other', () => {
    const left = makeWall([rectanglePolygon([0, 0], [100, 100])], { outlinedAlone: false });
    const right = makeWall([rectanglePolygon([100, 0], [200, 100])], { outlinedAlone: false });
    const groups = groupWalls([left, right]);

    expect(groups).toHaveLength(1);
    expect(groups[0].hull).toEqual(monotoneChainHull([
      ...left.polygons.flat(), ...right.polygons.flat(),
    ]));
    // Apart, neither is worth an outline.
    expect(groupWalls([left])).toEqual([]);
  });

  it('lets a trace join two shapes under one outline', () => {
    const left = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const right = makeWall([rectanglePolygon([300, 0], [400, 100])]);
    const bridge = makeWall([[[90, 40], [310, 40], [310, 200], [90, 200]] as Point[]],
      { outlinedAlone: false });

    expect(groupWalls([left, right])).toHaveLength(2);
    const groups = groupWalls([left, right, bridge]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toHaveLength(3);
    expect(groups[0].hull).toEqual(monotoneChainHull([
      ...left.polygons.flat(), ...right.polygons.flat(), ...bridge.polygons.flat(),
    ]));
  });
});
