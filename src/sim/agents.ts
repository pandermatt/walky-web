import { randomBrightColor, BLACK, type RGB } from '../palette';
import { distance, type Point } from './geometry';
import { Behaviour, SQRT2 } from './behaviour';
import type { Navigation } from './navigation';
import type { SpatialHash } from './spatialHash';

/**
 * Agent state, kept as a structure of arrays so it can move to a worker and into
 * deck.gl's attribute buffers without a per-agent object walk.
 *
 * Step 3 moves agents straight toward their waypoint. The full
 * PedestrianBehaviour port -- the integer 8-direction lattice, the diagonal
 * cadence and preferred-space avoidance -- lands in step 4.
 */
export class Agents {
  x: Float32Array;
  y: Float32Array;
  originX: Float32Array;
  originY: Float32Array;
  /** Goal wall id, or -1 when unassigned. */
  goal: Int32Array;
  /** Packed RGB, one byte per channel. */
  color: Uint32Array;
  arrived: Uint8Array;
  waypointX: Float32Array;
  waypointY: Float32Array;
  hasWaypoint: Uint8Array;
  /** Graph node the waypoint came from, or -1 when heading straight to the goal. */
  waypointNode: Int32Array;
  /**
   * Step accounting, in float64 because the original used Java doubles and the
   * arithmetic is exact-comparison sensitive: the counter is clamped to exactly
   * sqrt(2), and a diagonal costs exactly sqrt(2). Held in a Float32Array the
   * clamp rounds *down* below the cost, so a diagonal becomes unaffordable
   * forever and the agent deadlocks the moment it wants to turn.
   */
  /** Budget for this tick; a diagonal costs sqrt(2), an axis step costs 1. */
  speedCounter: Float64Array;
  /** Straight steps banked since the last diagonal. */
  stepsTaken: Float64Array;
  /** How many straight steps to bank before the next diagonal is allowed. */
  stepsUntil: Float64Array;
  /** Remaining distance to the goal; lower means higher priority in a crowd. */
  costToGoal: Float32Array;
  count = 0;

  constructor(private capacity = 4096) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.originX = new Float32Array(capacity);
    this.originY = new Float32Array(capacity);
    this.goal = new Int32Array(capacity);
    this.color = new Uint32Array(capacity);
    this.arrived = new Uint8Array(capacity);
    this.waypointX = new Float32Array(capacity);
    this.waypointY = new Float32Array(capacity);
    this.hasWaypoint = new Uint8Array(capacity);
    this.waypointNode = new Int32Array(capacity).fill(-1);
    this.speedCounter = new Float64Array(capacity);
    this.stepsTaken = new Float64Array(capacity);
    this.stepsUntil = new Float64Array(capacity);
    this.costToGoal = new Float32Array(capacity).fill(Infinity);
  }

  add(at: Point, color: RGB = randomBrightColor()): number {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    this.x[i] = at[0]; this.y[i] = at[1];
    this.originX[i] = at[0]; this.originY[i] = at[1];
    this.goal[i] = -1;
    this.color[i] = packRgb(color);
    this.arrived[i] = 0;
    this.hasWaypoint[i] = 0;
    this.speedCounter[i] = 0;
    this.stepsTaken[i] = 0;
    this.stepsUntil[i] = 0;
    this.costToGoal[i] = Infinity;
    return i;
  }

  clear(): void { this.count = 0; }

  /**
   * Removes one agent by swapping the last into its slot. Order is not meaningful
   * -- nothing holds an index across ticks -- so this avoids shifting the arrays.
   */
  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last];
    this.originX[i] = this.originX[last]; this.originY[i] = this.originY[last];
    this.goal[i] = this.goal[last];
    this.color[i] = this.color[last];
    this.arrived[i] = this.arrived[last];
    this.waypointX[i] = this.waypointX[last]; this.waypointY[i] = this.waypointY[last];
    this.hasWaypoint[i] = this.hasWaypoint[last];
    this.waypointNode[i] = this.waypointNode[last];
    this.speedCounter[i] = this.speedCounter[last];
    this.stepsTaken[i] = this.stepsTaken[last];
    this.stepsUntil[i] = this.stepsUntil[last];
    this.costToGoal[i] = this.costToGoal[last];
  }

  /** Back to origin, as controller Resetable / Map.resetPedestrianLocation did. */
  resetPositions(): void {
    for (let i = 0; i < this.count; i++) {
      this.x[i] = this.originX[i];
      this.y[i] = this.originY[i];
      this.arrived[i] = 0;
      this.hasWaypoint[i] = 0;
      this.speedCounter[i] = 0;
      this.stepsTaken[i] = 0;
    }
  }

  setGoal(i: number, wallId: number, wallColor: RGB): void {
    this.goal[i] = wallId;
    // A pedestrian takes the colour of the goal it is heading for.
    this.color[i] = packRgb(wallColor);
    this.arrived[i] = 0;
    this.hasWaypoint[i] = 0;
  }

  /**
   * Advance every agent one tick.
   *
   * Mirrors IntelligentPedestrian.makeStep: top up the speed counter, then spend
   * it on whole lattice steps until it runs out or the agent cannot move.
   */
  step(nav: Navigation, hash: SpatialHash, speed: number, radius: number, preferred: number): void {
    hash.build(this.x, this.y, this.count, Math.max(1, 2 * (radius + preferred)));
    const behaviour = new Behaviour(this, nav, hash);

    for (let i = 0; i < this.count; i++) {
      if (this.arrived[i]) continue;
      const goalId = this.goal[i];
      if (goalId < 0 || !nav.hasGoal(goalId)) continue;

      const here: Point = [this.x[i], this.y[i]];
      if (nav.hasArrived(here, goalId, radius + 1)) {
        this.arrived[i] = 1;
        this.color[i] = packRgb(BLACK); // matches IntelligentPedestrian:113
        continue;
      }

      // Top up the step budget, capped at one tick's worth.
      //
      // The original clamped this to sqrt(2) inside stepTowards on every call,
      // which quietly made speed above ~1.41 do nothing at all -- a pedestrian
      // could only ever buy one step per frame however high the setting went. The
      // cap is kept (a blocked pedestrian must not bank budget across ticks and
      // then lurch forward once freed) but raised to the speed itself, so the
      // setting actually controls how far a pedestrian gets per frame. At speed 1
      // this is exactly the original's sqrt(2).
      const cap = Math.max(speed, SQRT2);
      this.speedCounter[i] = Math.min(this.speedCounter[i] + speed, cap);

      let stepTaken = true;
      while (this.speedCounter[i] >= 1 && stepTaken) {
        if (!this.hasWaypoint[i]) {
          const next = nav.nextWaypoint([this.x[i], this.y[i]], goalId);
          if (!next) {
            // No route: jiggle. Either it is embedded in a wall's expanded hull
            // and works its way out, or the goal is genuinely unreachable and it
            // fidgets in place rather than freezing.
            const escape = behaviour.escapeStep(i, radius, preferred);
            if (escape.length === 0) this.speedCounter[i] = 0;
            stepTaken = escape.length > 0;
            continue;
          }
          this.waypointX[i] = next.point[0];
          this.waypointY[i] = next.point[1];
          this.costToGoal[i] = next.cost;
          this.waypointNode[i] = next.node;
          this.hasWaypoint[i] = 1;
        }

        // String-pull: if the node *after* the current waypoint is already in
        // sight, aim straight at it instead.
        //
        // This is what the original did by re-picking the furthest visible point
        // on its path every step (getNextGoalPointIndex). Without it every agent
        // walks to the exact same corner coordinate before turning, so crowds
        // pile up on graph nodes and appear to stick at them. Skipping ahead lets
        // them cut the corner and fan out.
        if (this.waypointNode[i] >= 0) {
          const ahead = nav.successorOf(this.waypointNode[i], goalId);
          const aheadPos = nav.nodePosition(ahead);
          if (aheadPos && nav.canSee([this.x[i], this.y[i]], aheadPos)) {
            this.waypointX[i] = aheadPos[0];
            this.waypointY[i] = aheadPos[1];
            this.waypointNode[i] = ahead;
          }
        }

        const target: Point = [this.waypointX[i], this.waypointY[i]];
        const result = behaviour.stepTowards(i, target, radius, preferred);
        stepTaken = result.length > 0;
        if (result.replan) this.hasWaypoint[i] = 0;

        // Close enough to the waypoint: take the next one.
        if (distance([this.x[i], this.y[i]], target) <= 1) this.hasWaypoint[i] = 0;

        if (nav.hasArrived([this.x[i], this.y[i]], goalId, radius + 1)) {
          this.arrived[i] = 1;
          this.color[i] = packRgb(BLACK);
          break;
        }
      }
    }
  }

  private grow(): void {
    const next = this.capacity * 2;
    const copy = <T extends Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array>(
      src: T, make: (n: number) => T,
    ): T => { const out = make(next); out.set(src); return out; };
    this.x = copy(this.x, (n) => new Float32Array(n));
    this.y = copy(this.y, (n) => new Float32Array(n));
    this.originX = copy(this.originX, (n) => new Float32Array(n));
    this.originY = copy(this.originY, (n) => new Float32Array(n));
    this.goal = copy(this.goal, (n) => new Int32Array(n));
    this.color = copy(this.color, (n) => new Uint32Array(n));
    this.arrived = copy(this.arrived, (n) => new Uint8Array(n));
    this.waypointX = copy(this.waypointX, (n) => new Float32Array(n));
    this.waypointY = copy(this.waypointY, (n) => new Float32Array(n));
    this.hasWaypoint = copy(this.hasWaypoint, (n) => new Uint8Array(n));
    this.waypointNode = copy(this.waypointNode, (n) => new Int32Array(n));
    this.speedCounter = copy(this.speedCounter, (n) => new Float64Array(n));
    this.stepsTaken = copy(this.stepsTaken, (n) => new Float64Array(n));
    this.stepsUntil = copy(this.stepsUntil, (n) => new Float64Array(n));
    this.costToGoal = copy(this.costToGoal, (n) => new Float32Array(n));
    this.capacity = next;
  }
}

export function packRgb(c: RGB): number {
  return ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
}

export function unpackRgb(v: number): RGB {
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
