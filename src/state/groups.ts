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
 * Walls with `sharesOutline` false -- freehand traces -- still group like any
 * other shape, so a squiggle laid across two buildings still puts them under one
 * outline. What they do not do is contribute points to that outline: the shared
 * hull is taken over the group's sharing members only, so a traced shape never
 * stretches the outline out to cover itself.
 *
 * Such a wall is not left without an outline, though. It gets a group of its own
 * holding nothing but itself, hulled over its own points, so the convex-hull view
 * shows a hull for every shape drawn -- the trace's hull simply describes the
 * trace rather than everything it happens to touch. See Wall.sharesOutline.
 */
export interface WallGroup {
  /** Every wall in the group, lowest id first. */
  wallIds: number[];
  /**
   * The members the hull was built from, lowest id first. Never empty. For a
   * connected group that is its sharing members; for a wall that shares no
   * outline it is that wall alone.
   */
  hullWallIds: number[];
  /** Convex hull over every point of every wall in `hullWallIds`. */
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

export function groupWalls(walls: Wall[], tolerance = GROUP_TOLERANCE): WallGroup[] {
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
  // wall the hull was built from, and must not change as unrelated shapes are
  // added elsewhere on the map.
  const byId = (a: number, b: number) => a - b;

  const groups: WallGroup[] = [];
  for (const members of byRoot.values()) {
    // Only sharing members shape the group's outline; the rest are in the group
    // but invisible to it, which is what keeps a traced shape from bloating it.
    const sharing = members.filter((i) => walls[i].sharesOutline);
    if (sharing.length > 0) {
      const points: Point[] = [];
      for (const i of sharing) points.push(...walls[i].polygons.flat());
      groups.push({
        wallIds: members.map((i) => walls[i].id).sort(byId),
        hullWallIds: sharing.map((i) => walls[i].id).sort(byId),
        hull: monotoneChainHull(points),
      });
    }

    // Everything held out of that outline is hulled on its own, so a traced shape
    // still gets a hull -- one that describes the trace and nothing else. That is
    // the wall's own hull, which is exactly this hull of one member.
    for (const i of members) {
      if (walls[i].sharesOutline) continue;
      groups.push({
        wallIds: [walls[i].id],
        hullWallIds: [walls[i].id],
        hull: walls[i].hull.map((p) => [p[0], p[1]] as Point),
      });
    }
  }
  return groups.sort((a, b) => a.hullWallIds[0] - b.hullWallIds[0]);
}
