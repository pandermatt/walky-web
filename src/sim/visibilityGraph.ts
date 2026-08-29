import { expandPolygon, pointInPolygon, pointSegmentDistance, segmentsCross, distance, type Point } from './geometry';

/** Tolerance for "this point sits on the hull outline rather than inside it". */
const BOUNDARY_EPSILON = 1e-6;
import type { CsrGraph } from './dijkstra';
import { convexDecompose } from './convexDecompose';
import type { Wall } from '../state/model';

/**
 * How much further out the graph nodes sit than the blocking boundary.
 *
 * Without it a node lands exactly *on* the hull it belongs to, where
 * point-in-polygon is a coin flip and half the surrounding lattice cells are
 * illegal. Pedestrians could then never legally stand on their own waypoint and
 * would stall against the corner, jittering. A couple of units of clearance makes
 * every node a position a pedestrian can actually occupy.
 */
export const NODE_MARGIN = 2;

export interface Obstacle {
  wallId: number;
  /** Index of this convex part among all obstacles, used for ring adjacency. */
  partId: number;
  /** One convex part of the wall, pushed out by the pedestrian radius. */
  hull: Point[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * A whole wall's convex hull, expanded by the radius: the shape the original drew
 * dashed. Kept as a broad phase -- anything that misses the shell cannot touch any
 * of the wall's convex parts, so the per-part work is skipped entirely.
 */
export interface WallShell {
  wallId: number;
  hull: Point[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/** A wall's shell together with its convex parts, so the broad phase needs no lookup. */
export interface WallGroup {
  shell: WallShell | null;
  parts: Obstacle[];
}

export interface Blockers {
  obstacles: Obstacle[];
  shells: WallShell[];
  groups: WallGroup[];
}

export interface VisibilityGraph extends Blockers {
  nodes: Point[];
  /** Which wall each node's part belongs to; goals are seeded by this. */
  nodeWall: Int32Array;
  /** Which convex part each node came from. */
  nodePart: Int32Array;
  /** Position of each node within its own hull ring, for the adjacency rule. */
  nodeRingIndex: Int32Array;
  ringLength: Int32Array;
  csr: CsrGraph;
}

function bboxOf(poly: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function segmentMissesBox(a: Point, b: Point, box: Obstacle['bbox']): boolean {
  return (Math.max(a[0], b[0]) < box.minX) || (Math.min(a[0], b[0]) > box.maxX)
    || (Math.max(a[1], b[1]) < box.minY) || (Math.min(a[1], b[1]) > box.maxY);
}

/**
 * Whether a straight walk from `a` to `b` is possible.
 *
 * The hulls are already expanded by the pedestrian radius, so clearance is built
 * into the geometry -- which is why this needs no distance-to-wall check, unlike
 * Map.isVisible(), which tested raw wall lines and then re-checked every corner
 * against the pedestrian radius.
 *
 * Two rules:
 *  1. The segment must not properly cross any hull edge.
 *  2. Its midpoint must not fall strictly inside a hull. This is what rejects a
 *     chord between two non-adjacent corners of the *same* convex hull, which
 *     crosses no edge yet passes straight through the building.
 *
 * The midpoint is exempt when it lies *on* the outline. Walking from one hull
 * corner to the next puts the midpoint exactly on that edge, and ray casting on
 * the boundary is a coin flip -- without the exemption, agents cannot walk along
 * a wall they are standing against and park on the corner forever.
 */
export function isVisible(a: Point, b: Point, blockers: Blockers): boolean {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Broad phase: a wall whose shell the segment never touches cannot be hit by
  // any of its convex parts, so skip the whole group. Walls are pre-grouped with
  // their parts so this allocates nothing -- it runs for every candidate edge and
  // every legality check, so a per-call Set here costs more than it saves.
  for (const group of blockers.groups) {
    const shell = group.shell;
    if (shell) {
      if (segmentMissesBox(a, b, shell.bbox)) continue;
      if (!touchesHull(a, b, mid, shell.hull)) continue;
    }
    for (const ob of group.parts) {
      if (segmentMissesBox(a, b, ob.bbox)) continue;
      const hull = ob.hull;
      let onOutline = false;
      for (let i = 0, n = hull.length; i < n; i++) {
        const p = hull[i];
        const q = hull[(i + 1) % n];
        if (segmentsCross(a, b, p, q)) return false;
        if (!onOutline && pointSegmentDistance(p, q, mid) <= BOUNDARY_EPSILON) onOutline = true;
      }
      if (!onOutline && pointInPolygon(hull, mid)) return false;
    }
  }
  return true;
}

/** Whether a segment enters or crosses a convex outline at all. */
function touchesHull(a: Point, b: Point, mid: Point, hull: Point[]): boolean {
  for (let i = 0, n = hull.length; i < n; i++) {
    if (segmentsCross(a, b, hull[i], hull[(i + 1) % n])) return true;
  }
  return pointInPolygon(hull, a) || pointInPolygon(hull, b) || pointInPolygon(hull, mid);
}

/**
 * Builds the graph Dijkstra runs over: nodes are the corners of every wall's
 * convex hull expanded by the pedestrian radius, edges join corners that can see
 * each other.
 *
 * Construction is the naive O(n^2) pair sweep with a bounding-box reject per
 * obstacle, which is ample for the hundreds of corners a hand-drawn map produces.
 * The upgrade path if that ever stalls is Lee's rotational plane sweep; nothing
 * outside this function would need to change.
 */
export function buildVisibilityGraph(walls: Wall[], radius: number): VisibilityGraph {
  const obstacles: Obstacle[] = [];
  const nodes: Point[] = [];
  const nodeWall: number[] = [];
  const nodePart: number[] = [];
  const nodeRingIndex: number[] = [];
  const ringLength: number[] = [];

  // Each wall contributes one obstacle per convex part. For a convex wall that is
  // a single part identical to its hull; for a U or an L it is several, which is
  // what keeps the cavity walkable instead of hulled over.
  const shells: WallShell[] = [];
  // Node positions live on a slightly larger ring than the blocking hull, so that
  // every node is somewhere a pedestrian can legally stand.
  const nodeRings: Point[][] = [];

  for (const wall of walls) {
    if (wall.hull.length >= 3) {
      const shellHull = expandPolygon(wall.hull, radius);
      shells.push({ wallId: wall.id, hull: shellHull, bbox: bboxOf(shellHull) });
    }
    for (const poly of wall.polygons) {
      for (const part of convexDecompose(poly)) {
        if (part.length < 3) continue;
        const hull = expandPolygon(part, radius);
        obstacles.push({ wallId: wall.id, partId: obstacles.length, hull, bbox: bboxOf(hull) });
        nodeRings.push(expandPolygon(part, radius + NODE_MARGIN));
      }
    }
  }
  const groups: WallGroup[] = walls.map((w) => ({
    shell: shells.find((sh) => sh.wallId === w.id) ?? null,
    parts: obstacles.filter((ob) => ob.wallId === w.id),
  }));
  const blockers: Blockers = { obstacles, shells, groups };

  // A corner swallowed by another building's hull is not standable, so drop it.
  for (let o = 0; o < obstacles.length; o++) {
    const ob = obstacles[o];
    const ring = nodeRings[o];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      let blocked = false;
      for (let k = 0; k < obstacles.length && !blocked; k++) {
        if (k === o) continue;
        if (pointInPolygon(obstacles[k].hull, p)) blocked = true;
      }
      if (blocked) continue;
      nodes.push(p);
      nodeWall.push(ob.wallId);
      nodePart.push(ob.partId);
      nodeRingIndex.push(i);
      ringLength.push(ring.length);
    }
  }

  // Pairwise visibility.
  const n = nodes.length;
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const costs: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Every pair gets a real visibility test, including two corners of the same
      // convex part.
      //
      // There used to be a shortcut here: corners of one part were taken as
      // mutually visible if they were ring neighbours, on the reasoning that
      // walking around your own convex hull is always safe. It is not. A wall
      // made of several parts can have one part lying across another's edge --
      // a vertical bar crossing the underside of a horizontal one -- and the
      // shortcut let the graph run an edge straight through it, so pedestrians
      // walked into a wall and jammed against it.
      //
      // The shortcut existed to dodge the boundary ambiguity of a segment running
      // exactly along the hull it belongs to. That is no longer a concern: nodes
      // sit on a ring NODE_MARGIN outside the blocking hull, so the segment
      // between two of them is strictly outside and decides cleanly.
      if (!isVisible(nodes[i], nodes[j], blockers)) continue;
      const w = distance(nodes[i], nodes[j]);
      neighbours[i].push(j); costs[i].push(w);
      neighbours[j].push(i); costs[j].push(w);
    }
  }

  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + neighbours[i].length;
  const targets = new Int32Array(offsets[n]);
  const weights = new Float32Array(offsets[n]);
  for (let i = 0, k = 0; i < n; i++) {
    for (let e = 0; e < neighbours[i].length; e++, k++) {
      targets[k] = neighbours[i][e];
      weights[k] = costs[i][e];
    }
  }

  return {
    nodes,
    nodeWall: Int32Array.from(nodeWall),
    nodePart: Int32Array.from(nodePart),
    nodeRingIndex: Int32Array.from(nodeRingIndex),
    ringLength: Int32Array.from(ringLength),
    obstacles,
    shells,
    groups,
    csr: { nodeCount: n, offsets, targets, weights },
  };
}

/** Node indices belonging to a given wall -- the seed set for a goal's Dijkstra run. */
export function nodesOfWall(graph: VisibilityGraph, wallId: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < graph.nodeWall.length; i++) {
    if (graph.nodeWall[i] === wallId) out.push(i);
  }
  return out;
}
