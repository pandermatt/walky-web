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

  it('groups the shapes of a multi-polygon wall as one, since it is one wall', () => {
    const twoBars = makeWall([
      rectanglePolygon([0, 0], [400, 12]),
      rectanglePolygon([0, 288], [400, 300]),
    ]);
    expect(groupWalls([twoBars])).toHaveLength(1);
  });

  it('handles an empty map', () => {
    expect(groupWalls([])).toEqual([]);
  });

  it('outlines a shape that touches nothing, on its own', () => {
    const trace: Point[] = [[0, 0], [100, 0], [100, 100], [40, 60], [0, 100]];
    const freehand = makeWall([trace]);
    const groups = groupWalls([freehand]);

    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([freehand.id]);
    expect(groups[0].hull).toEqual(monotoneChainHull(trace));
  });

  it('hulls a traced shape together with what it touches, points and all', () => {
    const solid = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const freehand = makeWall([rectanglePolygon([90, 90], [400, 400])]);
    const groups = groupWalls([solid, freehand]);

    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([solid.id, freehand.id].sort((a, b) => a - b));
    // The outline is the group's, so every member shapes it.
    expect(groups[0].hull).toEqual(monotoneChainHull([
      ...solid.polygons.flat(), ...freehand.polygons.flat(),
    ]));
  });

  it('lets a traced shape join two others under one outline', () => {
    const left = makeWall([rectanglePolygon([0, 0], [100, 100])]);
    const right = makeWall([rectanglePolygon([300, 0], [400, 100])]);
    const bridge = makeWall([[[90, 40], [310, 40], [310, 200], [90, 200]] as Point[]]);

    // Apart, the two rectangles are two outlines.
    expect(groupWalls([left, right])).toHaveLength(2);
    const groups = groupWalls([left, right, bridge]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toHaveLength(3);
    expect(groups[0].hull).toEqual(monotoneChainHull([
      ...left.polygons.flat(), ...right.polygons.flat(), ...bridge.polygons.flat(),
    ]));
  });
});

/**
 * A border frame is left out of the hull grouping. Its hull is the room it
 * encloses, and since it reaches around the whole map, everything inside touches
 * it -- grouped, the frame's outline would be the only one left on the map.
 */
describe('groupWalls and border frames', () => {
  const frame = () => makeWall(borderFrame([-500, -340] as Point, [400, 310] as Point, 4), { isBorder: true });

  it('draws no outline for a border frame on its own', () => {
    expect(groupWalls([frame()])).toEqual([]);
  });

  it('does not swallow a shape that pokes through the frame', () => {
    // The reported scenario: a rectangle overlapping the frame's left bar.
    const building = makeWall([rectanglePolygon([-560, -76], [-303, -12])]);
    const groups = groupWalls([frame(), building]);

    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([building.id]);
    expect(groups[0].hull).toEqual(monotoneChainHull(building.polygons.flat()));
  });

  it('hulls two shapes inside a frame to themselves, not to the frame', () => {
    const across = makeWall([rectanglePolygon([-560, -76], [-303, -12])]);
    const upright = makeWall([rectanglePolygon([-407, -204], [-335, -34])]);
    const groups = groupWalls([frame(), across, upright]);

    expect(groups).toHaveLength(1);
    expect(groups[0].wallIds).toEqual([across.id, upright.id].sort((x, y) => x - y));
    // The two rectangles, not the frame: nothing reaches the frame's corners.
    expect(groups[0].hull).toEqual(
      monotoneChainHull([...across.polygons.flat(), ...upright.polygons.flat()]),
    );
  });

  it('does not join two shapes that only touch each other through the frame', () => {
    const west = makeWall([rectanglePolygon([-560, -76], [-303, -12])]);
    const east = makeWall([rectanglePolygon([300, -76], [500, -12])]);
    expect(groupWalls([frame(), west, east])).toHaveLength(2);
  });
});
