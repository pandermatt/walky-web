import { closestPointOnSegment, distance, pointInPolygon, type Point } from './geometry';
import type { Obstacle } from './visibilityGraph';
import type { Navigation } from './navigation';
import type { SpatialHash } from './spatialHash';
import type { Agents } from './agents';

/** = the length of a diagonal step (AbstractPedestrian.SQUARE_ROOT_OF_TWO). */
export const SQRT2 = 1.41421356237;

/**
 * How a pedestrian decides its next step, ported from
 * pedestrians/PedestrianBehaviour.
 *
 * The parts that give the crowd its character are all kept: the integer
 * 8-direction lattice, the speed counter that lets a diagonal cost sqrt(2), the
 * cadence that spaces diagonal steps out so a shallow angle is walked as a
 * staircase, the three-way priority (keep preferred space, else step direct, else
 * step at random) and the x100 penalty that makes a pedestrian avoid crowds
 * heading somewhere other than its own goal.
 *
 * What changed is only how neighbours are found: a spatial hash instead of the
 * original's scan over every pedestrian.
 */

export interface StepResult {
  /** Distance covered: 0, 1, or sqrt(2). */
  length: number;
  /** Whether the agent should re-plan its waypoint. */
  replan: boolean;
}

const NO_STEP: StepResult = { length: 0, replan: true };

function stepLengthOf(dx: number, dy: number): number {
  const both = Math.abs(dx) + Math.abs(dy);
  return both === 2 ? SQRT2 : both;
}

export class Behaviour {
  constructor(
    private agents: Agents,
    private nav: Navigation,
    private hash: SpatialHash,
  ) {}

  /**
   * A coordinate is legal when it is clear of every wall, and does not put this
   * pedestrian on top of another.
   *
   * The overlap rule is "no worse than now" rather than "none at all". Strict
   * non-overlap deadlocks any crowd that is already packed tighter than two radii
   * -- every candidate cell has a neighbour too close, so nothing is legal, and
   * the whole crowd freezes solid and never recovers. That state is reachable in
   * normal use: raise the radius setting, or let the wall-escape step (which
   * ignores other pedestrians) push two together. Allowing moves that reduce the
   * crush keeps the no-overlap guarantee whenever it already holds -- if nothing
   * overlaps here, only a non-overlapping cell is accepted -- while letting a
   * jammed crowd work itself apart.
   */
  isLegal(px: number, py: number, self: number, radius: number): boolean {
    if (this.insideAnyWall([px, py])) return false;
    const there = this.agentOverlap(px, py, self, radius);
    if (there === 0) return true;
    const here = this.agentOverlap(this.agents.x[self], this.agents.y[self], self, radius);
    return there < here;
  }

  /** Total penetration into other pedestrians at a position; 0 when clear. */
  private agentOverlap(px: number, py: number, self: number, radius: number): number {
    const a = this.agents;
    const min = radius * 2;
    const near = this.hash.query(px, py, min, self, a.x, a.y);
    let total = 0;
    for (let k = 0; k < near.length; k++) {
      const j = near[k];
      if (a.arrived[j]) continue; // pedestrians that reached their target are ignored
      const d = Math.hypot(a.x[j] - px, a.y[j] - py);
      if (d < min) total += min - d;
    }
    return total;
  }

  /**
   * How much other pedestrians intrude on this one's preferred space at a
   * candidate location. Ported from totalToNearDistance(), including the x100
   * weighting for pedestrians bound for a different goal -- which is what makes
   * opposing streams part rather than merge.
   */
  private crowding(px: number, py: number, self: number, radius: number, preferred: number): number {
    const a = this.agents;
    const reach = radius + preferred + radius;
    const near = this.hash.query(px, py, reach, self, a.x, a.y);
    let total = 0;
    for (let k = 0; k < near.length; k++) {
      const j = near[k];
      if (!this.yieldsTo(self, j)) continue;
      const d = Math.hypot(a.x[j] - px, a.y[j] - py);
      const sameGoal = a.goal[j] === a.goal[self];
      total += (preferred - d) * (sameGoal ? 1 : 100);
    }
    return total;
  }

  /**
   * Whether `self` has to give way to `other`.
   *
   * Ported from Map.getColosionPedestrian, whose filter is easy to miss: a
   * neighbour only counts when it is inside the preferred space AND has not
   * arrived AND `self` does *not* outrank it. Rank is remaining distance to the
   * goal (PedestrianBehaviour.hasPriorityTo), so whoever is closest to the target
   * ignores everyone and keeps walking. Without this pecking order every member
   * of a dense crowd yields to every other and the block churns in place instead
   * of draining toward the goal.
   */
  private yieldsTo(self: number, other: number): boolean {
    const a = this.agents;
    if (a.arrived[other]) return false;
    return !(a.costToGoal[self] < a.costToGoal[other]);
  }

  private hasCrowding(px: number, py: number, self: number, radius: number, preferred: number): boolean {
    const a = this.agents;
    const near = this.hash.query(px, py, radius + preferred + radius, self, a.x, a.y);
    for (let k = 0; k < near.length; k++) if (this.yieldsTo(self, near[k])) return true;
    return false;
  }

  /** One step towards `target`. Mirrors PedestrianBehaviour.stepTowards. */
  stepTowards(i: number, target: Point, radius: number, preferred: number): StepResult {
    const a = this.agents;
    if (a.speedCounter[i] < 1) return { length: 0, replan: false };

    const x = a.x[i];
    const y = a.y[i];

    let dx: number;
    let dy: number;
    let ignoreDiagonal = false;

    if (!this.hasCrowding(x, y, i, radius, preferred)) {
      dx = Math.sign(target[0] - x);
      dy = Math.sign(target[1] - y);
    } else {
      // Too close to others: move whichever way relieves the crush.
      const here = this.crowding(x, y, i, radius, preferred);
      dx = this.crowding(x + 1, y, i, radius, preferred) < here ? 1 : -1;
      dy = this.crowding(x, y + 1, i, radius, preferred) < here ? 1 : -1;
      ignoreDiagonal = true;
    }

    return this.tryStep(i, dx, dy, target, ignoreDiagonal, radius, preferred);
  }

  private tryStep(
    i: number, dx: number, dy: number, target: Point,
    ignoreDiagonal: boolean, radius: number, preferred: number,
  ): StepResult {
    const a = this.agents;
    const x = a.x[i];
    const y = a.y[i];

    if (dx === 0 && dy === 0) return { length: 0, replan: true };

    const xDistance = Math.abs(x - target[0]);
    const yDistance = Math.abs(y - target[1]);
    if (a.stepsTaken[i] < 0) a.stepsTaken[i] = 0;

    // A shallow approach angle is walked as a staircase: one diagonal every
    // `stepsUntil` straight steps.
    const larger = Math.max(xDistance, yDistance);
    const smaller = Math.min(xDistance, yDistance);
    a.stepsUntil[i] = smaller === 0 ? Infinity : (larger / smaller) - 1;

    const yHasPriority = yDistance > xDistance;
    const diagonal: Point = [x + dx, y + dy];
    let second: Point = [x, y + dy];
    let third: Point = [x + dx, y];
    if (!yHasPriority) { const t = second; second = third; third = t; }

    let replan = true;

    if (this.isLegal(diagonal[0], diagonal[1], i, radius)) {
      if (dx === 0 || dy === 0 || ignoreDiagonal || a.stepsTaken[i] >= a.stepsUntil[i]) {
        const len = stepLengthOf(dx, dy);
        // Wait rather than overspend the counter on a diagonal.
        if (a.speedCounter[i] < len) return { length: 0, replan: false };
        return this.commit(i, diagonal, len, true);
      }
      // Not yet time for the diagonal: fall through to an axis step.
      replan = false;
    }

    if (this.isLegal(second[0], second[1], i, radius) && !(second[0] === x && second[1] === y)) {
      return this.commit(i, second, stepLengthOf(second[0] - x, second[1] - y), replan);
    }
    if (this.isLegal(third[0], third[1], i, radius) && !(third[0] === x && third[1] === y)) {
      return this.commit(i, third, stepLengthOf(third[0] - x, third[1] - y), true);
    }
    return this.randomStep(i, radius, preferred);
  }

  /**
   * How far inside a wall's expanded hull this point sits: 0 when clear, else the
   * distance to the nearest way out.
   */
  private penetration(p: Point): number {
    let worst = 0;
    for (const ob of this.nav.obstacles) {
      if (!this.inShell(p, ob.wallId)) continue;
      if (p[0] < ob.bbox.minX || p[0] > ob.bbox.maxX
        || p[1] < ob.bbox.minY || p[1] > ob.bbox.maxY) continue;
      if (!pointInPolygon(ob.hull, p)) continue;
      worst = Math.max(worst, this.distanceOut(p, ob));
    }
    return worst;
  }

  /**
   * Broad phase. A wall's convex hull encloses all of its convex parts, so a point
   * outside the hull cannot be inside any part and the per-part work is skipped.
   * For a wall of many parts this is the difference between one test and a dozen.
   */
  private inShell(p: Point, wallId: number): boolean {
    for (const shell of this.nav.shells) {
      if (shell.wallId !== wallId) continue;
      if (p[0] < shell.bbox.minX || p[0] > shell.bbox.maxX
        || p[1] < shell.bbox.minY || p[1] > shell.bbox.maxY) return false;
      return pointInPolygon(shell.hull, p);
    }
    return true;
  }

  private insideAnyWall(p: Point): boolean {
    for (const ob of this.nav.obstacles) {
      if (!this.inShell(p, ob.wallId)) continue;
      if (p[0] < ob.bbox.minX || p[0] > ob.bbox.maxX
        || p[1] < ob.bbox.minY || p[1] > ob.bbox.maxY) continue;
      if (pointInPolygon(ob.hull, p)) return true;
    }
    return false;
  }

  /** Distance from an interior point to the nearest point on the hull outline. */
  private distanceOut(p: Point, ob: Obstacle): number {
    let best = Infinity;
    const h = ob.hull;
    for (let i = 0, n = h.length; i < n; i++) {
      best = Math.min(best, distance(p, closestPointOnSegment(h[i], h[(i + 1) % n], p)));
    }
    return best;
  }

  /** The outward direction from an interior point, as a unit-ish lattice step. */
  private outwardFrom(p: Point): Point | null {
    let best: Point | null = null;
    let bestDist = Infinity;
    for (const ob of this.nav.obstacles) {
      if (!pointInPolygon(ob.hull, p)) continue;
      const h = ob.hull;
      for (let i = 0, n = h.length; i < n; i++) {
        const q = closestPointOnSegment(h[i], h[(i + 1) % n], p);
        const d = distance(p, q);
        if (d < bestDist) { bestDist = d; best = q; }
      }
    }
    return best;
  }

  /**
   * What a pedestrian does when it has no route at all: jiggle until it finds one.
   *
   * The original did the same on a failed path search -- updateFastestPath()
   * catches the failure and falls back to makeRandomStep(). Two cases matter:
   *
   *  - Stuck inside a wall's expanded hull. This happens when a shape is drawn
   *    over a pedestrian, when two shapes merge around it, or when the radius is
   *    raised so the hull swallows it. A plain random step cannot help, because
   *    every neighbouring cell is inside the hull too, so the pedestrian would sit
   *    there forever. Here it is allowed to move as long as the step gets it
   *    closer to the outside, which walks it out and then hands it back to normal
   *    pathfinding. Other pedestrians are ignored while escaping -- being briefly
   *    overlapped is better than being permanently embedded in a wall.
   *  - Outside, but the goal is unreachable. Then it simply jiggles in place,
   *    which is the visible signal that there is no way through.
   */
  escapeStep(i: number, radius: number, preferred: number): StepResult {
    const a = this.agents;
    const here: Point = [a.x[i], a.y[i]];
    const depth = this.penetration(here);

    if (depth === 0) return this.randomStep(i, radius, preferred);

    // Head for the nearest way out, with a random tie-break so a pedestrian
    // pinned exactly on an axis still works itself loose.
    const target = this.outwardFrom(here);
    let dx = 0;
    let dy = 0;
    if (target) {
      dx = Math.sign(Math.round(target[0] - here[0]));
      dy = Math.sign(Math.round(target[1] - here[1]));
    }
    if (dx === 0 && dy === 0) {
      dx = Math.floor(Math.random() * 3) - 1;
      dy = Math.floor(Math.random() * 3) - 1;
    }

    const candidates: Point[] = [
      [here[0] + dx, here[1] + dy],
      [here[0] + dx, here[1]],
      [here[0], here[1] + dy],
      [here[0] + (Math.random() < 0.5 ? 1 : -1), here[1]],
      [here[0], here[1] + (Math.random() < 0.5 ? 1 : -1)],
    ];

    for (const c of candidates) {
      if (c[0] === here[0] && c[1] === here[1]) continue;
      // Accept anything that gets us out, or at least less deeply in.
      if (this.penetration(c) < depth) {
        return this.commit(i, c, stepLengthOf(c[0] - here[0], c[1] - here[1]), true);
      }
    }
    return NO_STEP;
  }

  /** Last resort when every preferred direction is blocked. */
  randomStep(i: number, radius: number, _preferred: number): StepResult {
    const a = this.agents;
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    if (dx === 0 && dy === 0) return NO_STEP;
    const nx = a.x[i] + dx;
    const ny = a.y[i] + dy;
    if (!this.isLegal(nx, ny, i, radius)) return NO_STEP;
    return this.commit(i, [nx, ny], stepLengthOf(dx, dy), true);
  }

  private commit(i: number, to: Point, length: number, replan: boolean): StepResult {
    const a = this.agents;
    a.x[i] = to[0];
    a.y[i] = to[1];
    // Spend the counter, and advance or reset the diagonal cadence.
    a.speedCounter[i] -= length;
    if (length === SQRT2) a.stepsTaken[i] -= a.stepsUntil[i];
    else a.stepsTaken[i] += length;
    return { length, replan };
  }
}
