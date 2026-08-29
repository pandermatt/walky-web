import {
  buildVisibilityGraph, isVisible, nodesOfWall,
  type Blockers, type Obstacle, type WallShell, type VisibilityGraph,
} from './visibilityGraph';
import { dijkstra, type DijkstraResult } from './dijkstra';
import { closestPointOnSegment, distance, type Point } from './geometry';
import type { Wall } from '../state/model';

/** Sub-pixel: how close counts as "already standing on this node". */
const ON_NODE_EPSILON = 0.5;

export interface Waypoint {
  point: Point;
  /**
   * Remaining distance to the goal through this waypoint. This is the original's
   * distanceToGoal(), which decided which pedestrian outranks which in a crowd --
   * except the original re-walked its whole path to get it, while here it falls
   * out of the same scan that picked the waypoint.
   */
  cost: number;
  /** Index of the graph node aimed at, or -1 when heading straight to the goal. */
  node: number;
}

/**
 * The inverted form of the original's navigation.
 *
 * IntelligentPedestrian.generateFastestPath() rebuilt the whole visibility graph
 * and ran Dijkstra once per pedestrian per step. Here the graph is built once per
 * map edit and Dijkstra runs once per *goal*, producing a distance-to-goal for
 * every node. Cost goes from O(agents x graph) per step to O(goals x graph) per
 * edit, and every agent reads the same field.
 */
export class Navigation {
  private graph: VisibilityGraph = {
    nodes: [], nodeWall: new Int32Array(0), nodePart: new Int32Array(0),
    nodeRingIndex: new Int32Array(0),
    ringLength: new Int32Array(0), obstacles: [], shells: [], groups: [],
    csr: { nodeCount: 0, offsets: new Int32Array(1), targets: new Int32Array(0), weights: new Float32Array(0) },
  };
  /**
   * goal wall id -> cost-to-goal plus predecessors for every node. `prev` points
   * *towards* the goal, because the run is seeded from the goal's perimeter, so
   * following it from any node walks the shortest path in.
   */
  private fields = new Map<number, DijkstraResult>();
  private radius = 13;

  rebuild(walls: Wall[], radius: number): void {
    this.radius = radius;
    this.graph = buildVisibilityGraph(walls, radius);
    this.fields.clear();
    for (const wall of walls) {
      if (!wall.isGoal) continue;
      const sources = nodesOfWall(this.graph, wall.id);
      this.fields.set(wall.id, dijkstra(this.graph.csr, sources));
    }
  }

  get obstacles(): Obstacle[] { return this.graph.obstacles; }
  /** Whole-wall convex hulls, expanded: the broad phase in front of the parts. */
  get shells(): WallShell[] { return this.graph.shells; }
  get blockers(): Blockers { return this.graph; }
  get nodes(): Point[] { return this.graph.nodes; }
  get pedestrianRadius(): number { return this.radius; }

  hasGoal(wallId: number): boolean { return this.fields.has(wallId); }

  /**
   * Where an agent at `from` should head next on its way to `goalWallId`.
   *
   * A direct line to the goal always wins -- the original checked this too, in
   * setDirectPathIfPossible(). Otherwise pick the visible graph node with the
   * lowest "distance to it plus its cost-to-goal", which is the same choice the
   * original made after simplifyPath(), minus the per-agent graph rebuild.
   */
  nextWaypoint(from: Point, goalWallId: number): Waypoint | null {
    const parts = this.graph.obstacles.filter((o) => o.wallId === goalWallId);
    if (parts.length === 0) return null;

    // A concave goal is several convex parts; take the nearest visible point on
    // any of them.
    let direct: Point | null = null;
    let directDist = Infinity;
    for (const part of parts) {
      const p = this.closestVisiblePointOnHull(from, part);
      if (!p) continue;
      const d = distance(from, p);
      if (d < directDist) { directDist = d; direct = p; }
    }
    if (direct) return { point: direct, cost: directDist, node: -1 };

    const result = this.fields.get(goalWallId);
    if (!result) return null;
    const field = result.dist;

    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < this.graph.nodes.length; i++) {
      const cost = field[i];
      if (!Number.isFinite(cost)) continue;
      const node = this.graph.nodes[i];
      const step = distance(from, node);
      // Skip the node the agent is standing on. By the triangle inequality it
      // always minimises step + cost, so without this an agent that reaches a
      // corner re-selects that corner forever and parks there. It also avoids a
      // degenerate visibility test on a zero-length segment whose midpoint sits
      // exactly on a hull boundary.
      if (step < ON_NODE_EPSILON) continue;
      const total = step + cost;
      if (total >= bestCost) continue;
      if (!isVisible(from, node, this.graph)) continue;
      bestCost = total;
      best = i;
    }
    return best >= 0
      ? { point: this.graph.nodes[best], cost: bestCost, node: best }
      : null;
  }

  /** Position of a graph node. */
  nodePosition(node: number): Point | null {
    return node >= 0 && node < this.graph.nodes.length ? this.graph.nodes[node] : null;
  }

  /**
   * The next node towards the goal after `node`, or -1 at the goal itself.
   * `prev` was filled by a run seeded from the goal, so it already points inward.
   */
  successorOf(node: number, goalWallId: number): number {
    const result = this.fields.get(goalWallId);
    if (!result || node < 0) return -1;
    return result.prev[node];
  }

  /** Whether a straight walk between two points is unobstructed. */
  canSee(a: Point, b: Point): boolean {
    return isVisible(a, b, this.graph);
  }

  /**
   * The remaining route from a graph node to its goal, for the debug overlay.
   * Reads straight off the Dijkstra predecessors, so it costs nothing beyond
   * walking the path itself.
   */
  pathFromNode(node: number, goalWallId: number): Point[] {
    const result = this.fields.get(goalWallId);
    if (!result || node < 0) return [];
    const out: Point[] = [];
    let at = node;
    for (let guard = 0; at !== -1 && guard <= result.prev.length; guard++) {
      out.push(this.graph.nodes[at]);
      at = result.prev[at];
    }
    return out;
  }

  /**
   * The whole route a pedestrian standing at `from` would walk to `goalWallId`,
   * from its own position through to the goal.
   *
   * This is what pathFromNode() gives an agent that is already walking, for one
   * that has not stepped yet: pick the waypoint it would pick on its first step,
   * then read the rest off the same predecessors. It costs one nextWaypoint()
   * scan, so it is for the paused preview, not for the per-frame path overlay of
   * a running crowd -- those agents already carry a waypoint node.
   */
  routeFrom(from: Point, goalWallId: number): Point[] {
    const next = this.nextWaypoint(from, goalWallId);
    if (!next) return [];
    // node -1 means the goal itself is in sight, so the route is that one hop.
    const rest = next.node >= 0 ? this.pathFromNode(next.node, goalWallId) : [];
    return rest.length > 0 ? [from, ...rest] : [from, next.point];
  }

  /** True when the agent is close enough to its goal hull to stop. */
  hasArrived(from: Point, goalWallId: number, tolerance: number): boolean {
    for (const part of this.graph.obstacles) {
      if (part.wallId !== goalWallId) continue;
      const hull = part.hull;
      for (let i = 0, n = hull.length; i < n; i++) {
        const p = closestPointOnSegment(hull[i], hull[(i + 1) % n], from);
        if (distance(p, from) <= tolerance) return true;
      }
    }
    return false;
  }

  private closestVisiblePointOnHull(from: Point, goal: Obstacle): Point | null {
    const hull = goal.hull;
    let best: Point | null = null;
    let bestDist = Infinity;
    for (let i = 0, n = hull.length; i < n; i++) {
      const p = closestPointOnSegment(hull[i], hull[(i + 1) % n], from);
      const d = distance(p, from);
      if (d >= bestDist) continue;
      if (!isVisible(from, p, this.graph)) continue;
      bestDist = d;
      best = p;
    }
    return best;
  }
}
