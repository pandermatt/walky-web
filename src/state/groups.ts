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
 * Walls with `hulled` false -- freehand traces -- take no part in this: they are
 * neither hulled themselves nor allowed to pull a neighbour's outline out to
 * cover them. See Wall.hulled.
 */
export interface WallGroup {
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

export function groupWalls(input: Wall[], tolerance = GROUP_TOLERANCE): WallGroup[] {
  const walls = input.filter((w) => w.hulled);
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

  const groups: WallGroup[] = [];
  for (const members of byRoot.values()) {
    const points: Point[] = [];
    for (const i of members) points.push(...walls[i].polygons.flat());
    groups.push({
      // Sorted so the lowest id is first: the outline's colour comes from it and
      // must not change as unrelated shapes are added.
      wallIds: members.map((i) => walls[i].id).sort((a, b) => a - b),
      hull: monotoneChainHull(points),
    });
  }
  return groups;
}
