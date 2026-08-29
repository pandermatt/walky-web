import { randomBrightColor, BLACK, type RGB } from '../palette';
import { distance, type Point } from './geometry';
import { Behaviour, SQRT2, interactionReach, paceScale, crowdPace } from './behaviour';
import type { Navigation } from './navigation';
import type { SpatialHash } from './spatialHash';
import type { RestoredAgent } from '../state/scenario';

/** Everything about the crowd that an undo has to put back; see Agents.snapshot. */
export interface AgentsSnapshot {
  count: number;
  x: Float32Array;
  y: Float32Array;
  originX: Float32Array;
  originY: Float32Array;
  goal: Int32Array;
  color: Uint32Array;
  arrived: Uint8Array;
  selected: Uint8Array;
}

/**
 * Agent state, kept as a structure of arrays so it can move to a worker and into
 * deck.gl's attribute buffers without a per-agent object walk.
 *
 * The step accounting is float64 because the original used Java doubles and the
 * arithmetic is exact-comparison sensitive: the budget is clamped to exactly
 * sqrt(2) and a diagonal costs exactly sqrt(2). Held in a Float32Array the clamp
 * rounds *down* below the cost, so a diagonal becomes unaffordable forever and the
 * agent deadlocks the moment it wants to turn.
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
  /** Budget for this tick; a diagonal costs sqrt(2), an axis step costs 1. */
  speedCounter: Float64Array;
  /**
   * Smoothed unit direction of travel, and the only memory the lattice keeps of
   * which way a pedestrian was going.
   *
   * Everything that makes the crowd read as people rather than as particles hangs
   * off it: which side of you counts as "in front", where a neighbour will be in a
   * moment, how sharp a turn is, and which way to pass someone. Zero until the
   * first step, and every rule that reads it falls back to caring equally about
   * every direction while it is.
   */
  headingX: Float32Array;
  headingY: Float32Array;
  /** Consecutive steps spent standing still; patience that runs out. */
  waited: Float32Array;
  /**
   * How hard the crowd behind is pressing on this pedestrian.
   *
   * The one genuinely physical quantity in the model. Everything else here is a
   * pedestrian deciding something; this is a thing done to it. It accumulates from
   * neighbours who want to be where it is standing and cannot get there, and it
   * carries their pressure onward as well as their own, so it builds through a
   * queue and is greatest at the front -- which is the whole point. Whoever is
   * against the barrier feels the entire crowd, not just the person behind them.
   */
  pressure: Float32Array;
  /**
   * Which way the crowd is leaning on this pedestrian, as a unit vector.
   *
   * Pressure has only ever been a scalar, which is enough to decide how much room
   * somebody gives up but not enough to shove them anywhere. This is the direction
   * a pedestrian is carried when the load gets past what it can hold out against --
   * the difference between a crowd that changes your mind and one that moves you.
   */
  pushX: Float32Array;
  pushY: Float32Array;
  /**
   * How many others were within arm's reach at the last step.
   *
   * Density, in the plainest form the model has, and the input to how fast this one
   * walks. The room it manages to keep would seem the obvious measure and is not:
   * that figure is floored and saturating by the time anything reads it, so a crowd
   * packed to a standstill and one merely busy come out a few percent apart.
   */
  density: Float32Array;
  /**
   * A stable number in [0,1) that makes this pedestrian slightly its own person:
   * how much room it keeps and how briskly it walks are both scaled by it.
   *
   * A crowd where everyone wants exactly the same space and moves at exactly the
   * same pace behaves like a lattice -- it locks into ranks, and nobody ever has
   * a reason to overtake. Real variation is what makes a crowd fan out, form
   * lanes and thin at the edges.
   *
   * Derived from where the pedestrian was placed rather than stored, because a
   * trait has to survive undo and Reset, and its origin is the one piece of
   * identity it already carries through both. That keeps the undo snapshot to the
   * four things a map edit can actually change.
   */
  trait: Float32Array;
  /**
   * Where this pedestrian sits between giving way and getting on with it.
   *
   * Nought is somebody who keeps their distance, defers, and will stand and wait
   * as long as it takes. One is somebody who walks close enough to make you move,
   * leans on whoever is in front, and finds waiting intolerable.
   *
   * It is the one place personal space stops being symmetric, and that asymmetry
   * is the whole point: an assertive pedestrian both wants less room for itself
   * and takes up more of everyone else's, so two of them meeting is a scrum and
   * two polite ones is an apology. A crowd of identical middling people has
   * neither, and reads as machinery.
   */
  assertiveness: Float32Array;
  /**
   * Who this one came onto the map with, or -1 for somebody walking alone.
   *
   * Most people in a real crowd are not in one: they are out in twos and threes,
   * and a crowd of strangers all moving independently is the thing that reads as
   * machinery however good the avoidance is. Membership is the placement coarsened
   * -- whoever was painted within about a metre of each other arrived together,
   * which is as good a definition as this model can have and the only one that
   * survives undo and Reset without being stored.
   *
   * Called a party rather than a group because a group here already means a
   * connected set of walls, and one word for two things is one too few.
   */
  party: Int32Array;
  /**
   * The room this pedestrian actually kept on its last step, after its own
   * temperament and the crush around it. Read by the personalSpace-radius overlay, so
   * the rings visibly tighten as a crowd packs.
   */
  effectiveSpace: Float32Array;
  /** Remaining distance to the goal; lower means higher priority in a crowd. */
  costToGoal: Float32Array;
  /** Lassoed by the selection tool; the mark-goal tool acts on these alone. */
  selected: Uint8Array;
  /**
   * Indices that crossed into `arrived` during the most recent `step`, so the
   * caller can react to the moment of arrival -- currently the plop sound.
   *
   * Valid until the next `step` or any mutation that moves agents between slots
   * (`removeAt`, `clear`), so read it straight after stepping.
   */
  readonly justArrived: number[] = [];
  /**
   * Involuntary steps taken this tick -- pedestrians the crowd moved rather than
   * ones that decided to move. Exists to be measured: "nobody is shoved in a crowd
   * with room to walk in" is not otherwise checkable.
   */
  carries = 0;
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
    this.headingX = new Float32Array(capacity);
    this.headingY = new Float32Array(capacity);
    this.waited = new Float32Array(capacity);
    this.pressure = new Float32Array(capacity);
    this.pushX = new Float32Array(capacity);
    this.pushY = new Float32Array(capacity);
    this.density = new Float32Array(capacity);
    this.trait = new Float32Array(capacity);
    this.assertiveness = new Float32Array(capacity);
    this.party = new Int32Array(capacity);
    this.effectiveSpace = new Float32Array(capacity);
    this.costToGoal = new Float32Array(capacity).fill(Infinity);
    this.selected = new Uint8Array(capacity);
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
    this.headingX[i] = 0;
    this.headingY[i] = 0;
    this.waited[i] = 0;
    this.pressure[i] = 0;
    this.pushX[i] = 0;
    this.pushY[i] = 0;
    this.density[i] = 0;
    this.trait[i] = traitOf(at[0], at[1], SPACE_SEED);
    this.assertiveness[i] = traitOf(at[0], at[1], NERVE_SEED);
    this.party[i] = partyOf(at[0], at[1]);
    this.effectiveSpace[i] = 0;
    this.costToGoal[i] = Infinity;
    this.selected[i] = 0;
    return i;
  }

  clear(): void { this.count = 0; }

  clearSelection(): void {
    this.selected.fill(0, 0, this.count);
  }

  get selectionCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.selected[i]) n++;
    return n;
  }

  /**
   * Whether every pedestrian with somewhere to be has got there: what "the run is
   * over" means, and what a recording watches for so it can stop itself.
   *
   * Pedestrians with no goal are not counted, in either direction. One standing
   * where it was painted is not waiting to arrive -- it was never going anywhere
   * -- and holding the answer back for it would mean a map with a single stray
   * dot never finishing. False with nobody bound for anywhere at all, since
   * "everyone has arrived" is not a thing an empty crowd has done.
   */
  get allArrived(): boolean {
    let bound = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.goal[i] < 0) continue;
      if (!this.arrived[i]) return false;
      bound++;
    }
    return bound > 0;
  }

  /** The pedestrian under a point, or -1. Topmost wins, as clicking expects. */
  indexAt(p: Point, radius: number): number {
    for (let i = this.count - 1; i >= 0; i--) {
      if (Math.hypot(this.x[i] - p[0], this.y[i] - p[1]) <= radius) return i;
    }
    return -1;
  }

  /**
   * Cuts loose every pedestrian bound for a wall that has just been erased.
   *
   * Not tidiness: Navigation has no field for a wall that is gone, so
   * nextWaypoint answers null and those pedestrians stand still for ever --
   * while `allArrived` goes on saying the run is unfinished, which is what a
   * recording waits for before it stops itself.
   *
   * The colour is left alone. It says where the pedestrian was going, which is
   * still the truth about it, and resetPositions already repaints a pedestrian
   * whose goal has been deleted since -- see the note there.
   */
  clearGoal(wallId: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.goal[i] !== wallId) continue;
      this.goal[i] = -1;
      this.arrived[i] = 0;
      this.hasWaypoint[i] = 0;
      this.costToGoal[i] = Infinity;
    }
  }

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
    this.headingX[i] = this.headingX[last];
    this.headingY[i] = this.headingY[last];
    this.waited[i] = this.waited[last];
    this.pressure[i] = this.pressure[last];
    this.pushX[i] = this.pushX[last];
    this.pushY[i] = this.pushY[last];
    this.density[i] = this.density[last];
    this.trait[i] = this.trait[last];
    this.assertiveness[i] = this.assertiveness[last];
    this.party[i] = this.party[last];
    this.effectiveSpace[i] = this.effectiveSpace[last];
    this.costToGoal[i] = this.costToGoal[last];
    this.selected[i] = this.selected[last];
  }

  /**
   * The crowd as it stands, copied out for undo.
   *
   * Only what a map edit can change is kept: where each pedestrian is, where it
   * started, what it is walking to and how it looks. The per-tick working state
   * -- waypoints, step budgets, the cost to goal -- is derived, so restoring it
   * would be storing a cache; `restore` clears it instead and the next tick
   * builds it again.
   */
  snapshot(): AgentsSnapshot {
    const n = this.count;
    return {
      count: n,
      x: this.x.slice(0, n),
      y: this.y.slice(0, n),
      originX: this.originX.slice(0, n),
      originY: this.originY.slice(0, n),
      goal: this.goal.slice(0, n),
      color: this.color.slice(0, n),
      arrived: this.arrived.slice(0, n),
      selected: this.selected.slice(0, n),
    };
  }

  /** Puts a snapshot back, whatever the crowd has become since. */
  restore(snap: AgentsSnapshot): void {
    while (this.capacity < snap.count) this.grow();
    const n = snap.count;
    this.x.set(snap.x); this.y.set(snap.y);
    this.originX.set(snap.originX); this.originY.set(snap.originY);
    this.goal.set(snap.goal);
    this.color.set(snap.color);
    this.arrived.set(snap.arrived);
    this.selected.set(snap.selected);
    // Derived state, cleared rather than restored: a waypoint belongs to a map
    // that may no longer exist, and a stale one would be walked to.
    this.hasWaypoint.fill(0, 0, n);
    this.waypointNode.fill(-1, 0, n);
    this.speedCounter.fill(0, 0, n);
    this.headingX.fill(0, 0, n);
    this.headingY.fill(0, 0, n);
    this.waited.fill(0, 0, n);
    this.pressure.fill(0, 0, n);
    this.pushX.fill(0, 0, n);
    this.pushY.fill(0, 0, n);
    this.density.fill(0, 0, n);
    this.effectiveSpace.fill(0, 0, n);
    // Not derived from the tick but from the pedestrian: recomputed rather than
    // restored, so it comes back identical without being stored.
    for (let i = 0; i < n; i++) {
      this.trait[i] = traitOf(this.originX[i], this.originY[i], SPACE_SEED);
      this.assertiveness[i] = traitOf(this.originX[i], this.originY[i], NERVE_SEED);
      this.party[i] = partyOf(this.originX[i], this.originY[i]);
    }
    this.costToGoal.fill(Infinity, 0, n);
    this.justArrived.length = 0;
    this.carries = 0;
    this.count = n;
  }

  /**
   * Back to origin, as controller Resetable / Map.resetPedestrianLocation did.
   *
   * The colour is painted again rather than kept, because a run leaves it saying
   * what happened -- black for everyone who arrived -- and a crowd put back on
   * its starting line still wearing the last run's result reads as a crowd that
   * has already finished.
   *
   * What it is painted is what the pedestrian is about to do: one still bound for
   * a goal gets that goal's colour, exactly as `setGoal` gave it, so the crowd
   * goes on matching the wall it is walking to. Only a pedestrian with nowhere to
   * be has no such colour to take, and gets a fresh random bright one -- the same
   * `add` gives a pedestrian that has never walked anywhere.
   *
   * `goalColors` maps wall id to colour; a goal missing from it -- a wall deleted
   * since, or a caller that has none to offer -- is a pedestrian with nowhere to
   * be, and is coloured as one.
   */
  resetPositions(goalColors: ReadonlyMap<number, RGB> = new Map()): void {
    for (let i = 0; i < this.count; i++) {
      this.x[i] = this.originX[i];
      this.y[i] = this.originY[i];
      this.color[i] = packRgb(goalColors.get(this.goal[i]) ?? randomBrightColor());
      this.arrived[i] = 0;
      this.hasWaypoint[i] = 0;
      this.speedCounter[i] = 0;
      this.headingX[i] = 0;
      this.headingY[i] = 0;
      this.waited[i] = 0;
      this.pressure[i] = 0;
      this.pushX[i] = 0;
      this.pushY[i] = 0;
      this.density[i] = 0;
      this.effectiveSpace[i] = 0;
    }
  }

  /**
   * Adds a pedestrian read off a saved scenario -- the inverse of what the JSON
   * and the link write out, and the only writer of goal and arrived outside a run.
   *
   * Not `restore`, which is undo's and puts a whole crowd back at once; this adds
   * one to whatever is already there. It goes through `add` rather than filling
   * the arrays itself, because `add` is the one place that knows the whole field
   * list -- `grow` and `restore` already repeat it, and a third copy is the one
   * that would go stale. What `add` leaves alone is right to leave alone: the
   * waypoint, the step budget and the cost to goal are all recomputed on the
   * first tick, and a selection is not something a shared map carries.
   */
  addRestored(a: RestoredAgent): number {
    const i = this.add([a.x, a.y], a.color);
    this.originX[i] = a.originX;
    this.originY[i] = a.originY;
    // Temperament comes from where a pedestrian was placed, and `add` had only
    // where it currently stands to go on. Left as it was, a crowd loaded from a
    // link mid-walk would take its temperaments from wherever everybody happened
    // to be standing, and then quietly swap them all for the real ones the first
    // time anybody pressed undo -- `restore` recomputes from the origin.
    this.trait[i] = traitOf(a.originX, a.originY, SPACE_SEED);
    this.assertiveness[i] = traitOf(a.originX, a.originY, NERVE_SEED);
    this.party[i] = partyOf(a.originX, a.originY);
    this.goal[i] = a.goal;
    this.arrived[i] = a.arrived ? 1 : 0;
    return i;
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
   * it on whole lattice steps until it runs out or the agent stops moving. A
   * pedestrian that chooses to stand still ends its tick with budget in hand,
   * which the cap below then takes back -- waiting must not bank into a lurch.
   */
  step(nav: Navigation, hash: SpatialHash, speed: number, radius: number, personalSpace: number): void {
    this.justArrived.length = 0;
    // Cells the size of the interaction range keep a neighbour query to the 3x3
    // block around an agent.
    hash.build(this.x, this.y, this.count, Math.max(1, interactionReach(radius, personalSpace, speed)));
    const behaviour = new Behaviour(this, nav, hash, speed);

    for (let i = 0; i < this.count; i++) {
      if (this.arrived[i]) continue;
      const goalId = this.goal[i];
      if (goalId < 0 || !nav.hasGoal(goalId)) continue;

      const here: Point = [this.x[i], this.y[i]];
      if (nav.hasArrived(here, goalId, radius + 1)) {
        this.markArrived(i);
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
      // Not everyone walks at the setting. Slower neighbours give the brisker ones
      // someone to overtake, which is most of what makes a crowd look like a crowd
      // rather than a block sliding across the map.
      // And slower the tighter it is: the room it managed to keep last step is
      // this model's measure of how packed it is standing.
      const own = speed * paceScale(this.trait[i]) * crowdPace(this.density[i]);
      const cap = Math.max(own, SQRT2);
      this.speedCounter[i] = Math.min(this.speedCounter[i] + own, cap);

      let stepTaken = true;
      while (this.speedCounter[i] >= 1 && stepTaken) {
        if (!this.hasWaypoint[i]) {
          const next = nav.nextWaypoint([this.x[i], this.y[i]], goalId);
          if (!next) {
            // No route: jiggle. Either it is embedded in a wall's expanded hull
            // and works its way out, or the goal is genuinely unreachable and it
            // fidgets in place rather than freezing.
            const escape = behaviour.escapeStep(i, radius, personalSpace);
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
        const result = behaviour.stepTowards(i, target, radius, personalSpace);
        stepTaken = result.length > 0;
        if (result.replan) this.hasWaypoint[i] = 0;

        // Close enough to the waypoint: take the next one.
        if (distance([this.x[i], this.y[i]], target) <= 1) this.hasWaypoint[i] = 0;

        if (nav.hasArrived([this.x[i], this.y[i]], goalId, radius + 1)) {
          this.markArrived(i);
          break;
        }
      }
    }
  }

  /** The one place an agent becomes arrived, so nothing that watches it is missed. */
  private markArrived(i: number): void {
    this.arrived[i] = 1;
    this.color[i] = packRgb(BLACK); // matches IntelligentPedestrian:113
    this.justArrived.push(i);
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
    this.headingX = copy(this.headingX, (n) => new Float32Array(n));
    this.headingY = copy(this.headingY, (n) => new Float32Array(n));
    this.waited = copy(this.waited, (n) => new Float32Array(n));
    this.pressure = copy(this.pressure, (n) => new Float32Array(n));
    this.pushX = copy(this.pushX, (n) => new Float32Array(n));
    this.pushY = copy(this.pushY, (n) => new Float32Array(n));
    this.density = copy(this.density, (n) => new Float32Array(n));
    this.trait = copy(this.trait, (n) => new Float32Array(n));
    this.assertiveness = copy(this.assertiveness, (n) => new Float32Array(n));
    this.party = copy(this.party, (n) => new Int32Array(n));
    this.effectiveSpace = copy(this.effectiveSpace, (n) => new Float32Array(n));
    this.costToGoal = copy(this.costToGoal, (n) => new Float32Array(n));
    this.selected = copy(this.selected, (n) => new Uint8Array(n));
    this.capacity = next;
  }
}

/**
 * Two independent traits are drawn from one placement, so they need one seed each
 * -- otherwise how much room somebody wants and how hard they press would be the
 * same number, and the crowd would have one personality rather than two crossed.
 */
export const SPACE_SEED = 0x9e3779b9;
export const NERVE_SEED = 0x85ebca6b;
export const PARTY_SEED = 0x27d4eb2f;

/**
 * How near two pedestrians had to be painted to count as out together, in pixels,
 * and how much of a crowd is with somebody at all.
 *
 * A constant rather than a multiple of the radius on purpose: the radius is a
 * setting, and deriving who is with whom from it would silently re-shuffle every
 * party on the map the moment somebody moved a slider. Company has to survive that,
 * the same way a temperament survives undo.
 */
const PARTY_CELL = 60;
const PARTY_SHARE = 0.45;

/** Which party a pedestrian belongs to, or -1 for one walking alone. */
export function partyOf(ox: number, oy: number): number {
  const cx = Math.floor(ox / PARTY_CELL);
  const cy = Math.floor(oy / PARTY_CELL);
  if (traitOf(cx, cy, PARTY_SEED) >= PARTY_SHARE) return -1;
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 1;
}

/**
 * A stable number in [0,1) from a placement, well spread for nearby inputs.
 *
 * The brush lays pedestrians on a regular pitch, so neighbouring origins differ by
 * a constant -- which a weaker mix would turn into a visible stripe of identical
 * temperaments across the crowd.
 */
export function traitOf(ox: number, oy: number, seed: number): number {
  let h = seed ^ Math.imul(Math.round(ox) | 0, 73856093) ^ Math.imul(Math.round(oy) | 0, 19349663);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function packRgb(c: RGB): number {
  return ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
}

export function unpackRgb(v: number): RGB {
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
