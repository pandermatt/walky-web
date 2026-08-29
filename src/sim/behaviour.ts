import { closestPointOnSegment, distance, pointInPolygon, type Point } from './geometry';
import type { Obstacle } from './visibilityGraph';
import type { Navigation } from './navigation';
import type { SpatialHash } from './spatialHash';
import type { Agents } from './agents';

/** = the length of a diagonal step (AbstractPedestrian.SQUARE_ROOT_OF_TWO). */
export const SQRT2 = 1.41421356237;

/**
 * How a pedestrian decides its next step.
 *
 * The lattice is kept from pedestrians/PedestrianBehaviour: eight integer
 * directions, a speed counter where a diagonal costs sqrt(2), and a pecking order
 * by remaining distance to the goal. What the original did with that lattice does
 * not survive, because it could not be made to behave.
 *
 * The original asked one question -- "is anyone inside my preferred space?" -- and
 * on a yes it stopped navigating outright and moved solely to relieve the crush.
 * The reach of that question is the preferred space, so the wider you set the
 * setting the more of the crowd was permanently in relief mode, and a crowd that
 * has stopped walking to its goal and is only pushing away from itself is exactly
 * what it looked like: people shoving. Turning the dial up made it worse.
 *
 * Here a pedestrian scores all nine things it could do -- the eight neighbouring
 * cells and standing still -- and takes the cheapest. Progress and comfort are
 * always weighed against each other, so a crowded pedestrian slows, sidesteps or
 * waits, but never stops heading for its goal. The terms:
 *
 *  - Progress, per unit of step budget. Rate rather than distance is what makes a
 *    shallow approach angle come out as a staircase: towards a 45-degree target a
 *    diagonal gains sqrt(2) for sqrt(2) spent and wins outright, while towards a
 *    shallow one it gains barely more than an axis step for half again the cost
 *    and loses. The original bought the same shape with an explicit cadence
 *    counter; it falls out of the geometry instead.
 *  - Discomfort, which decays exponentially with distance and is weighted by where
 *    a neighbour stands relative to the way you are facing. People guard the space
 *    in front of them and largely ignore what is behind (Helbing and Johansson's
 *    anisotropy); without that, pressure from behind scatters the front rank
 *    sideways, which is the other half of the shoving. The exponential matters
 *    too: under a linear falloff a dozen distant neighbours outvote the one person
 *    you are about to walk into.
 *  - Anticipation. Real pedestrians avoid where someone *will* be, not where they
 *    are, which is why crossing streams weave through each other instead of
 *    colliding and then sorting it out. Every neighbour is judged one lookahead
 *    along its own heading.
 *  - A turn penalty, so a path reads as walked rather than as a random walk that
 *    happened to arrive.
 *  - A passing side. Given a choice, step the same way everyone else does, and
 *    counterflow sorts itself into lanes.
 *  - The cost of standing still, which starts low and grows. This is what lets
 *    someone queue at a bottleneck rather than barge, while guaranteeing that a
 *    jam still drains: patience runs out, and a pedestrian who has waited long
 *    enough will accept a squeeze it first refused.
 *
 * Cost is why this is not slower than what it replaced. The original scanned every
 * pedestrian on the map; the first port of this file cut that to a spatial hash but
 * queried it about seven times per step, and scoring nine candidates against every
 * neighbour would have been worse again. Instead a single pass summarises the
 * neighbourhood into a discomfort *gradient*, and each candidate costs one dot
 * product against it. Every candidate is within sqrt(2)px, so the first-order term
 * is the whole story to a fraction of a pixel, and the constant part is shared by
 * all nine and cancels out of the comparison anyway.
 */

/**
 * Weight of a neighbour directly behind, against one directly ahead.
 * Helbing and Johansson fit ~0.2 to video of real crowds.
 */
const LAMBDA = 0.2;
/** Falloff length of the discomfort curve, as a fraction of the personal space. */
const DECAY_FRACTION = 0.3;
/** Extra weight for a neighbour bound somewhere other than here. */
const OPPOSING = 2.5;
/**
 * Weight of a neighbour this pedestrian outranks.
 *
 * The original made this 0: whoever was closest to the goal ignored everyone and
 * walked through them. The asymmetry is load-bearing -- without it every member of
 * a dense crowd yields to every other and the block churns in place -- but it does
 * not have to be absolute. Having right of way makes you less careful, not blind.
 */
const YIELD_LOW = 0.25;
/** Discomfort against progress. Progress is scaled to +-1, so this is the exchange rate. */
const W_SPACE = 6;
/**
 * Cost of turning away from the current heading, at a full reversal.
 *
 * Priced above a whole step of progress on purpose. It is what separates walking
 * from jittering: without it a crowd relieving pressure changes its mind every
 * step and the whole thing shimmers. Raising it from 0.35 to 1.2 took outright
 * reversals from 4.8% of moves to 0.7% and cost nothing in spacing.
 */
const W_TURN = 1.2;
/** Pull towards the conventional passing side when someone is coming the other way. */
const W_SIDE = 0.15;
/** Cost of standing still, before patience runs out. */
const W_WAIT = 0.3;
/** Steps of waiting after which standing still costs double. */
const PATIENCE = 10;
/**
 * How far ahead a neighbour is judged to be, in lattice steps.
 *
 * Anticipation, in its cheapest honest form: score where someone will be rather
 * than where they are.
 */
const LOOKAHEAD = 4;
/** How fast the smoothed heading follows the steps actually taken. */
const HEADING_SMOOTH = 0.35;

/**
 * How far a pedestrian can be influenced from: its own body, its personal space,
 * far enough again to see a collision coming, and one tick's travel of slack.
 *
 * The slack is not padding. The hash is built once at the top of a tick and agents
 * move within it, so a neighbour can be up to a tick's worth of steps from the cell
 * it was filed under; without the margin, the fastest-moving neighbours -- the ones
 * most worth noticing -- are the ones a query misses.
 *
 * Exported because the spatial hash wants its cell size to match: a query is a 3x3
 * block of cells when they agree, and a wider sweep when they do not.
 */
export function interactionReach(radius: number, preferred: number, speed: number): number {
  return 2 * radius + preferred + LOOKAHEAD + Math.max(0, speed);
}

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
    private speed: number,
  ) {}

  /**
   * The neighbours close enough that a step could overlap them. Usually a handful,
   * and it is the only list the legality check has to walk -- where the first port
   * of this file re-queried the hash for every candidate.
   */
  private bodyIdx = new Int32Array(64);
  private bodyCount = 0;
  /** Total penetration where the pedestrian stands now; the "no worse" baseline. */
  private hereOverlap = 0;
  /** Which way discomfort increases, and how steeply. */
  private gradX = 0;
  private gradY = 0;
  /** How much oncoming traffic there is to pass. */
  private oncoming = 0;

  /**
   * Everything about the neighbourhood that does not depend on which way the
   * pedestrian steps, in one pass.
   *
   * The discomfort field is summarised by its value's *gradient* rather than
   * sampled per candidate. Every candidate is within sqrt(2) px of here, so the
   * first-order term is the whole story to well under a tenth of a pixel, and the
   * constant part is shared by all nine and cancels out of the comparison. That
   * turns nine passes over the neighbours into one.
   */
  private survey(self: number, radius: number, personal: number, decay: number, reach: number): void {
    const a = this.agents;
    const found = this.hash.query(a.x[self], a.y[self], reach, self, a.x, a.y);
    const n = found.length;
    if (this.bodyIdx.length < n) this.bodyIdx = new Int32Array(n * 2);

    const hx = a.headingX[self];
    const hy = a.headingY[self];
    const facing = hx !== 0 || hy !== 0;
    const contact = 2 * radius;
    // A candidate is at most sqrt(2) away, so nothing further than this can be
    // overlapped by one.
    const bodyReach = contact + 2;
    const goalSelf = a.goal[self];
    const costSelf = a.costToGoal[self];

    let bodies = 0;
    let gx = 0;
    let gy = 0;
    let oncoming = 0;
    let here = 0;

    for (let k = 0; k < n; k++) {
      const j = found[k];
      if (a.arrived[j]) continue; // pedestrians that reached their target are ignored

      const trueX = a.x[j] - a.x[self];
      const trueY = a.y[j] - a.y[self];
      const trueD = Math.hypot(trueX, trueY);

      // Bodies, at their real positions: this is what may not be walked into.
      if (trueD < bodyReach) {
        this.bodyIdx[bodies++] = j;
        if (trueD < contact) here += contact - trueD;
      }

      // Everything else judges the neighbour where it is about to be, not where
      // it is. One displacement along its heading is the whole of anticipation:
      // two people converging on the same spot start avoiding it before they
      // arrive, which is how crossing streams weave rather than collide.
      const rx = trueX + a.headingX[j] * LOOKAHEAD;
      const ry = trueY + a.headingY[j] * LOOKAHEAD;
      const d = Math.hypot(rx, ry);
      if (d < 1e-6 || d >= personal) continue;

      let w = costSelf < a.costToGoal[j] ? YIELD_LOW : 1;
      if (a.goal[j] !== goalSelf) w *= OPPOSING;

      const ux = rx / d;
      const uy = ry / d;
      if (facing) {
        // Anisotropy: people guard the space in front of them and largely ignore
        // what is behind. Taken against the heading rather than against each
        // candidate, which keeps this loop candidate-free -- and is truer anyway,
        // since a pedestrian's sense of its own front turns as gradually as it does.
        const cos = ux * hx + uy * hy;
        w *= LAMBDA + (1 - LAMBDA) * (1 + cos) / 2;
        // Someone squarely ahead and walking back at us is someone to pass.
        if (cos > 0.5) {
          const closing = -(a.headingX[j] * hx + a.headingY[j] * hy);
          if (closing > 0) oncoming += closing;
        }
      }

      const e = Math.exp((personal - d) / decay);
      const scale = W_SPACE * w * e / decay;
      gx += scale * ux;
      gy += scale * uy;
    }

    this.bodyCount = bodies;
    this.hereOverlap = here;
    this.gradX = gx;
    this.gradY = gy;
    this.oncoming = oncoming;
  }

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
   *
   * Reads the survey, so `survey` must have run for this pedestrian.
   */
  isLegal(px: number, py: number, radius: number): boolean {
    if (this.insideAnyWall([px, py])) return false;
    const there = this.agentOverlap(px, py, radius);
    if (there === 0) return true;
    return there < this.hereOverlap;
  }

  /** Total penetration into other pedestrians at a position; 0 when clear. */
  private agentOverlap(px: number, py: number, radius: number): number {
    const a = this.agents;
    const min = radius * 2;
    let total = 0;
    for (let k = 0; k < this.bodyCount; k++) {
      const j = this.bodyIdx[k];
      const d = Math.hypot(a.x[j] - px, a.y[j] - py);
      if (d < min) total += min - d;
    }
    return total;
  }

  /** One step towards `target`: score all nine options and take the cheapest. */
  stepTowards(i: number, target: Point, radius: number, preferred: number): StepResult {
    const a = this.agents;
    if (a.speedCounter[i] < 1) return { length: 0, replan: false };

    const x = a.x[i];
    const y = a.y[i];
    const budget = a.speedCounter[i];
    const personal = 2 * radius + preferred;
    const decay = Math.max(1, DECAY_FRACTION * personal);

    this.survey(i, radius, personal, decay, interactionReach(radius, preferred, this.speed));

    const distHere = Math.hypot(target[0] - x, target[1] - y);
    const hx = a.headingX[i];
    const hy = a.headingY[i];
    const facing = hx !== 0 || hy !== 0;
    // The right hand of a pedestrian facing h. Screen y runs down, so walking
    // east that is south.
    const rightX = -hy;
    const rightY = hx;

    let bestCost = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    let bestLen = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const len = stepLengthOf(dx, dy);

        if (len === 0) {
          // Standing still is always on the table -- it is the option the original
          // lacked, which is why a blocked pedestrian there could only jiggle. It
          // is also the reference point every other candidate is measured against,
          // so it carries no discomfort term of its own.
          const cost = W_WAIT * (1 + a.waited[i] / PATIENCE);
          if (cost < bestCost) { bestCost = cost; bestDx = 0; bestDy = 0; bestLen = 0; }
          continue;
        }

        // A diagonal costs sqrt(2); wait rather than overspend the counter on one.
        if (len > budget) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.isLegal(nx, ny, radius)) continue;

        const ux = dx / len;
        const uy = dy / len;

        // Everything is priced per unit of distance travelled, which is what makes
        // a shallow approach angle come out as a staircase: a diagonal must earn
        // its sqrt(2) to beat an axis step.
        let cost = -(distHere - Math.hypot(target[0] - nx, target[1] - ny)) / len
          + this.gradX * ux + this.gradY * uy;

        if (facing) {
          cost += W_TURN * (1 - (ux * hx + uy * hy)) / 2;
          // Given a choice, pass the same side everyone else does.
          if (this.oncoming > 0) {
            cost -= W_SIDE * this.oncoming * (ux * rightX + uy * rightY);
          }
        }

        if (cost < bestCost) {
          bestCost = cost;
          bestDx = dx;
          bestDy = dy;
          bestLen = len;
        }
      }
    }

    if (bestLen === 0) {
      // Waiting, rather than being unable to move: the waypoint is still good, and
      // re-planning one costs a scan of the whole graph.
      a.waited[i] += 1;
      return { length: 0, replan: false };
    }
    return this.commit(i, [x + bestDx, y + bestDy], bestLen, true);
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

  /** Last resort when there is nowhere sensible to go. */
  randomStep(i: number, radius: number, preferred: number): StepResult {
    const a = this.agents;
    const dx = Math.floor(Math.random() * 3) - 1;
    const dy = Math.floor(Math.random() * 3) - 1;
    if (dx === 0 && dy === 0) return NO_STEP;
    const nx = a.x[i] + dx;
    const ny = a.y[i] + dy;
    const personal = 2 * radius + preferred;
    this.survey(i, radius, personal, Math.max(1, DECAY_FRACTION * personal),
      interactionReach(radius, preferred, this.speed));
    if (!this.isLegal(nx, ny, radius)) return NO_STEP;
    return this.commit(i, [nx, ny], stepLengthOf(dx, dy), true);
  }

  private commit(i: number, to: Point, length: number, replan: boolean): StepResult {
    const a = this.agents;
    const dx = to[0] - a.x[i];
    const dy = to[1] - a.y[i];
    a.x[i] = to[0];
    a.y[i] = to[1];
    a.speedCounter[i] -= length;
    a.waited[i] = 0;

    // Follow the steps actually taken, so the heading survives a sidestep without
    // swinging to meet it. It is what "in front of me" means everywhere above.
    const hx = a.headingX[i] + (dx / length - a.headingX[i]) * HEADING_SMOOTH;
    const hy = a.headingY[i] + (dy / length - a.headingY[i]) * HEADING_SMOOTH;
    const mag = Math.hypot(hx, hy);
    if (mag > 1e-6) { a.headingX[i] = hx / mag; a.headingY[i] = hy / mag; }

    return { length, replan };
  }
}
