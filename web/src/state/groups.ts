import { monotoneChainHull } from '../sim/convexHull';
import { segmentDistance, type Point } from '../sim/geometry';
import { polygonsOverlap, type Wall } from './model';

/**
 * Walls that touch or overlap, gathered into one group.
 *
 * Shapes drawn against each other should read as a single object, which is what
 * the dashed outline conveys. That used to be achieved by merging them into one
 * Wall, but merging cascades: draw anything against an enclosure and the
 * enclosure is swallowed. Grouping gives the same picture while every shape keeps
 * its own identity, colour and (eventually) deletability -- the grouping is
 * recomputed from scratch whenever walls change, so it can never accumulate.
 *
 * One group per connected set of shapes, one hull over all of it: a shape
 * touching nothing is a group of one and is hulled just the same, and a freehand
 * trace shapes the hull of whatever it touches like any other member -- a
 * squiggle laid across two buildings puts all three under one outline.
 *
 * Border frames are the one exception, and are skipped entirely: they get no
 * outline, and they join nothing to anything. A frame's hull is the solid
 * rectangle it encloses, so it would draw the room's walkable interior as if it
 * were the obstacle -- and since a frame reaches all the way round the map,
 * everything inside it touches it and would collapse into that single hull,
 * leaving the buildings inside with no outline of their own. Skipping the frame
 * is what lets two rectangles drawn inside an enclosure be hulled as the two
 * rectangles they are.
 */
export interface WallGroup {
  /** Every wall in the group, lowest id first. */
  wallIds: number[];
  /** Convex hull over every point of every wall in the group. */
  hull: Point[];
}

/** How close two walls must come to count as touching, in world units. */
export const GROUP_TOLERANCE = 1;

function wallsTouchWithin(a: Wall, b: Wall, tolerance: number): boolean {
  for (const pa of a.polygons) {
    for (const pb of b.polygons) {
      if (polygonsOverlap(pa, pb)) return true;
      for (let i = 0; i < pa.length; i++) {
        const a1 = pa[i];
        const a2 = pa[(i + 1) % pa.length];
        for (let j = 0; j < pb.length; j++) {
          const b1 = pb[j];
          const b2 = pb[(j + 1) % pb.length];
          if (segmentDistance(a1, a2, b1, b2) <= tolerance) return true;
        }
      }
    }
  }
  return false;
}

export function groupWalls(allWalls: Wall[], tolerance = GROUP_TOLERANCE): WallGroup[] {
  const walls = allWalls.filter((w) => !w.isBorder);
  const n = walls.length;
  if (n === 0) return [];

  // Union-find over touching pairs.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) { const next = parent[i]; parent[i] = root; i = next; }
    return root;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      if (wallsTouchWithin(walls[i], walls[j], tolerance)) parent[find(i)] = find(j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(i);
    else byRoot.set(root, [i]);
  }

  // Sorted so the lowest id is first: the outline's colour comes from the first
  // member, and must not change as unrelated shapes are added elsewhere.
  const byId = (a: number, b: number) => a - b;

  const groups: WallGroup[] = [];
  for (const members of byRoot.values()) {
    const points: Point[] = [];
    for (const i of members) points.push(...walls[i].polygons.flat());
    groups.push({
      wallIds: members.map((i) => walls[i].id).sort(byId),
      hull: monotoneChainHull(points),
    });
  }
  return groups.sort((a, b) => a.wallIds[0] - b.wallIds[0]);
}
