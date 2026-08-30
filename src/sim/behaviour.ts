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
 * The original asked one question -- "is anyone inside my personal space?" -- and
 * on a yes it stopped navigating outright and moved solely to relieve the crush.
 * The reach of that question is the personal space, so the wider you set the
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
 *    enough will accept a squeeze it first refused. Its far end is desperation
 *    (nerveOf, below): somebody who has been getting nowhere for seconds on end
 *    stops being polite altogether, and the crowd gives way around them.
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
 *
 * The rank itself is only really meaningful within one goal: costs to different
 * goals come from different distance fields, so between strangers the comparison
 * is arbitrary. It is kept anyway, as a deterministic tie-break -- two people
 * meeting for a moment need *a* winner more than they need the right one. Where
 * it goes wrong is when the arbitrary loser is held to the verdict for minutes,
 * which is what desperation (below) exists to undo.
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
 * How much brisker than the speed setting the briskest pedestrian walks.
 *
 * The variation goes upwards rather than around the setting because the budget
 * has to buy a whole lattice step within one tick: scaled below 1, a pedestrian at
 * speed 1 cannot afford a step on the tick it is offered one, and only moves every
 * other tick -- which at the lowest setting is most of the crowd stuttering.
 */
const PACE_SPREAD = 0.15;

/** A pedestrian's pace, as a multiple of the speed setting. */
export function paceScale(trait: number): number {
  return 1 + PACE_SPREAD * trait;
}

/** The room this one would keep if nobody were in the way. */
export function wantedSpace(trait: number, personalSpace: number): number {
  return personalSpace * (1 - SPACE_SPREAD * trait);
}

/**
 * What a pedestrian's pace comes to at a given amount of elbow room.
 *
 * The fundamental diagram from the other end. Personal space already gives way as
 * a crowd packs; this is what that costs in speed, and without it a jam is a crowd
 * standing at full stride, which is the one thing a jam is not.
 *
 * Weidmann fits an exponential in the density, and it is read off a plain count of
 * who is within arm's reach. The room a pedestrian manages to keep looks like the
 * measure to use and is not: by the time anything reads that figure it has been
 * floored and saturated, so a crowd packed to a standstill and one merely busy come
 * out a few percent apart -- the curve fitted to it never left 0.95.
 *
 * Reading last step's count is not a compromise: what it describes is a crowd, and
 * a crowd does not reorganise itself inside one tick.
 *
 * Flat until the crowd is genuinely a crowd, which is the shape of the measured
 * curve -- free flow holds its speed until a critical density and only then falls
 * away. It is also what keeps the promise made above about giving: slowing people
 * down makes them wait, waiting is what builds pressure, and pressure is what opens
 * the valve. Without the free-flow allowance a comfortably spaced crowd walking to
 * a goal generated just enough of it to start touching, which is exactly what the
 * valve is not for.
 *
 * At the slowest speed setting this takes the step budget below one, and a
 * pedestrian then moves every second or third tick rather than every tick. That
 * looks coarse and is not: it is what walking slowly looks like on a lattice, and
 * it only ever happens where the crowd is genuinely packed.
 */
const CROWD_PACE_FLOOR = 0.65;
const PACE_DECAY = 0.22;
export function crowdPace(density: number): number {
  const over = density - FREE_NEIGHBOURS;
  if (over <= 0) return 1;
  return CROWD_PACE_FLOOR + (1 - CROWD_PACE_FLOOR) * Math.exp(-PACE_DECAY * over);
}

/**
 * The same curve read the other way, for the router: how many times longer a
 * stretch of ground takes to walk when this many people stand on it.
 *
 * Deliberately not 1 / crowdPace. The floor above says a pedestrian in any
 * crush still shuffles at 65% pace, which caps 1/pace at 1.5 -- but a route
 * planner asking "should I go round?" is asking about the queue, not the
 * shuffle: time through a jam is dominated by waiting in it, which the pace
 * curve never sees. So the slowdown keeps the curve's shape and decay but is
 * let run past the shuffle floor, capped at three times the clear walk --
 * enough to prefer a detour twice as long around a real jam, and little
 * enough that a merely busy stretch never scares anybody off it.
 */
const SLOWDOWN_MAX = 3;
export function crowdSlowdown(density: number): number {
  const over = density - FREE_NEIGHBOURS;
  if (over <= 0) return 1;
  return Math.min(SLOWDOWN_MAX, 1 + PACE_DECAY * over);
}
/**
 * A pedestrian's share of the personal-space setting: between 0.8 and 1 of it.
 *
 * The setting is the room the most private person in the crowd wants, and the
 * rest want a little less -- rather than a mean everyone scatters around, which
 * would let an agent demand more space than the setting and quietly invalidate
 * the query reach built from it.
 */
const SPACE_SPREAD = 0.2;
/**
 * Neighbours within reach at which personal space has halved, and the floor it
 * cannot compress past.
 *
 * People accept less room as it gets crowded -- the fundamental diagram. This is
 * the direct answer to a personal space set high: rather than a crowd trying to
 * hold 90px apart in a corridor that cannot give it and shoving over the
 * shortfall, the requirement itself relaxes, and the crowd compresses and queues.
 * The setting stops being a lever that blows the crowd apart and becomes what it
 * says: the room people take when there is room to take.
 */
const DENSITY_HALF = 3;
const COMPRESS_FLOOR = 0.25;
/**
 * Crowd pressure: the part a pedestrian cannot decide its way out of.
 *
 * Density on its own is circular. A crowd holds the spacing it wants, so the
 * density that would compress that spacing never arises, and a queue backed up by
 * a hundred people stands as politely as a queue of three. What it misses is that
 * being pressed is not the same as being near: the people behind you want to be
 * where you are standing and cannot get there, and that is a load on you whether
 * or not they have closed the distance yet.
 *
 * So a held-up pedestrian aimed at you leans on you, and passes on what is leaning
 * on it as well as its own weight. The load builds along a queue and peaks at the
 * front, against the barrier -- which is why crowd pressure is dangerous at the
 * front of a crush and unremarkable at the back.
 *
 * PRESSURE_HALF is the load at which a pedestrian gives up half the room it
 * wanted. What it will not give up whatever the load is COMPRESS_FLOOR, shared
 * with density above, and the two are combined by taking whichever asks for less
 * rather than by multiplying them.
 *
 * Multiplying them deadlocks, which is worth recording. Pressure closes a crowd
 * up, closing it up raises the density, the density compresses it again, and the
 * product runs to nothing in a few ticks: the crowd packs to body contact, where
 * "no worse than now" has no move left to offer anybody, and a bottleneck arches
 * over and stays that way. A 64-strong crowd at a gap went from all 64 through to
 * 12 through and then nothing at all, for eighteen hundred further ticks. Real
 * crowds do arch at a bottleneck; they do not do it permanently.
 */
const PRESSURE_HALF = 6;
/**
 * How far the assertive and the polite pull apart, on each of the things
 * assertiveness touches.
 *
 * Personal space is symmetric everywhere else in this file -- I avoid you exactly
 * as much as you avoid me -- and these are the numbers that break that. An
 * assertive pedestrian commands more of the crowd's regard, leans harder on
 * whoever is in front, and finds standing still dearer. A polite one does the
 * reverse. Two assertive people meeting is a scrum; two polite ones is an apology.
 *
 * All of it points *outward*, at what this pedestrian is to everybody else, and
 * that is a finding rather than a preference. Letting assertiveness point inward
 * as well -- some of them simply minding the crowd less, or keeping a smaller
 * bubble -- reads like the same idea and behaves like the opposite one. It varies
 * the geometry the crowd packs into, and a narrow bottleneck then arches over and
 * stays arched: a 64-strong crowd went from all through on every layout tried to
 * as few as two, and no amount of the outward half rescued it.
 *
 * The outward half on its own does the reverse, and it is worth saying why. An
 * arch is held up by everybody in it deferring equally; the deadlock is a
 * symmetry. Unequal presence gives the arch a weak point, so it collapses instead
 * of setting. The same bottleneck deadlocked on some layouts before this existed
 * -- as few as 11 of 64 got through -- and now clears every one of them.
 */
/** How much of the crowd's regard it commands: 0.65 when polite, 1.35 when not. */
const NERVE_PRESENCE = 0.2;
/** What standing still costs it: 0.4x when polite, 1.6x when not. */
const NERVE_IMPATIENCE = 1.2;
/** How hard it leans on the person in front: 0.5x when polite, 1.5x when not. */
const NERVE_LEAN = 1.0;

/**
 * How far a body will give when the crowd leans on it, as a fraction of its radius,
 * and the load at which half of that is available.
 *
 * Bodies are not rigid, and pretending they are had a specific cost. With no give
 * anywhere, a crowd that packs to body contact has no legal move left: every
 * candidate cell is worse than standing still, so a bottleneck arches over and
 * stays arched. Real crowds arch at a gap too; they do not do it permanently, and
 * what breaks the arch is that somebody gets squeezed.
 *
 * Two properties keep this honest. It is nought below a threshold set above
 * anything a walking crowd produces, so being close to somebody never earns you the
 * right to walk into them -- only being genuinely crushed does. The threshold is
 * measured, not guessed: a comfortably spaced crowd walking round an obstacle peaks
 * at 1.05, a busy corridor at 1.29, and the front of a deep crush at 3.5. Because
 * the allowance is exactly nought below it, no temperament can switch it on --
 * aggression only scales something that is already zero.
 *
 * And the cap is per *pair*, not on the total. "No worse than now" is judged on the
 * sum, and a move that gathers the same sum onto one neighbour drives one body much
 * deeper into another while the sum reports that nothing happened. Capping the worst
 * pair is what makes the bound provable rather than merely likely: every accepted
 * move leaves the mover's worst pair no deeper than the cap, a pair is bounded by
 * each of its members, so the deepest overlap anywhere is bounded by the cap.
 */
export const SQUASH_MAX = 0.15;
const SQUASH_HALF = 4;
const SQUASH_ONSET = 1.5;
/** How much sooner the pushiest start giving -- never below a calm crowd's peak. */
const SHOVE_ONSET = 0.25;

/**
 * Where the pushy end of the crowd begins, and how little room it settles for.
 *
 * Assertiveness is spread evenly, and spreading *this* evenly with it is the thing
 * that must not happen. Every pedestrian wanting a slightly different amount of room
 * varies the geometry the whole crowd packs into, and a bottleneck arches over and
 * never recovers -- a five percent spread once took a 64-strong crowd from all
 * through to as few as two. What was wanted instead is a minority: seven in eight
 * behave exactly as before, and the last eighth ramps up to somebody who walks into
 * the space you were standing in.
 *
 * A minority behaves unlike a spread because they break arches rather than build
 * them. An arch is held up by everybody in it deferring equally; one pedestrian who
 * will not defer is a weak point rather than another stone.
 */
const BULLY_FROM = 0.88;
/** How much less of a crush it takes before a pushy one starts squeezing in. */
const SHOVE_SQUEEZE = 0.75;

/** How much shove is in a pedestrian: nought for most, total at the very top. */
function shoveOf(assertiveness: number): number {
  return Math.max(0, (assertiveness - BULLY_FROM) / (1 - BULLY_FROM));
}

/**
 * Desperation: how long somebody can get nowhere before they stop being polite.
 *
 * The map that forced this had one stream of twenty a second pouring into its
 * goal and a trickle of four a second whose path crossed it. Anybody bound
 * elsewhere who got caught in the crush around the busy goal was pinned there for
 * good: far from their own goal, they lose the rank comparison above to every
 * arrival, the arrivals never stop coming, and an ordinary temperament has no
 * squeeze to spend. Three pedestrians spent seventy of a ninety second run
 * pressed against that wall; watched from outside, they simply never cross.
 *
 * The tempting fix -- have the crowd keep a respectful distance from whoever is
 * visibly stuck -- was built first and measured, and it fails in exactly the way
 * this file keeps finding: a bubble of avoidance in a basin everybody is
 * converging on is a plug, and the busy stream's arrivals fell from 927 to as
 * few as 135 while the pinned stayed pinned. What actually gets a person out of
 * a press is the machinery the pushy minority already runs on: walk like you
 * mean it, lean on who is in front, accept the squeeze -- and the crowd gives
 * way around them, which is the yielding that was wanted all along.
 *
 * So a pedestrian stuck past DESPERATE_AFTER ramps its *effective* nerve up
 * towards the top of the scale over DESPERATE_RAMP, and everything temperament
 * already touches follows: presence, lean, impatience, and eventually shove.
 * Every one of them points outward or at its own patience, which is the lesson
 * of NERVE_PRESENCE above -- the desperate mind the crowd exactly as much as
 * they ever did, they just stop asking permission. Impatience is load-bearing rather
 * than flavour: tried without it, the pinned stood politely in the one legal
 * cell they had and stayed pinned four times as long. And the whole thing is
 * self-limiting: desperation is what moves them, moving decays the stall, and
 * the nerve settles back to temperament.
 *
 * The ramp reaches one further thing that temperament deliberately does not:
 * deference to the crowd bound the other way. All four nerve effects together
 * could not free somebody blocked by an *opposing* crowd, because none of
 * them touch the term that pins them -- an oncoming stranger's discomfort
 * weighs OPPOSING times more against a bubble a crush never closes, so the
 * cheapest move is a sideways shuffle, for ever, and shuffling resets the
 * patience that pressure and shove are gated on while `stalled` alone keeps
 * counting. So in `survey`, desperation eases both halves of that deference
 * toward what a same-goal neighbour gets: the extra weight toward one, the
 * open bubble toward the crushed one. Gated on this ramp rather than on
 * `nerveOf`, and the difference is the whole safety argument -- nerve would
 * hold the gate open for the pushiest eighth on every ordinary tick, where
 * the ramp opens it only for the provably stuck and closes it the moment
 * they move.
 *
 * Three seconds of getting nowhere before it starts, fully desperate two later.
 * A walking crowd never touches that -- the deep queue in a bottleneck does, and
 * is meant to: patience running out is what drains a jam, and the drain and the
 * pushy-first ordering both held when measured. On the crossing map the three
 * seventy-second pinnings fell to nobody stuck past eleven seconds, every
 * crosser through, and the busy stream *faster* -- its median arrival fell from
 * 241 to 175 ticks, because a desperate straggler clearing the doorway or the
 * basin was what everybody behind was waiting on.
 */
const DESPERATE_AFTER = 180;
const DESPERATE_RAMP = 240;

/**
 * How far past DESPERATE_AFTER this one is, 0 to 1: the ramp alone, with no
 * temperament in it. The gates that must not stay open for the naturally pushy
 * -- the opposing-space relaxation in `survey` -- read this rather than
 * `nerveOf`, or the pushiest eighth would discount the oncoming crowd's room
 * on every ordinary tick and counterflow would never sort.
 */
function desperationOf(a: Agents, i: number): number {
  return Math.min(1, Math.max(0, (a.stalled[i] - DESPERATE_AFTER) / DESPERATE_RAMP));
}

/** How bold this one is right now: its temperament, or its desperation if worse. */
function nerveOf(a: Agents, i: number): number {
  return Math.max(a.assertiveness[i], desperationOf(a, i));
}

/**
 * The load at which a pedestrian is half as able to add any push of its own, the
 * load at which the crowd starts moving it whether it likes or not, and how wildly
 * a shove wanders at the worst of it.
 *
 * Somebody crushed against a barrier is not bracing and shoving; they are a link in
 * a chain. What they add is damped and what they *transmit* is not -- the carried
 * term below is normalised by the undamped total on purpose, because damping both
 * halves would flatten the front-heavy gradient that makes a crush a crush.
 *
 * The measure of pinned is coherence, not size. Deep in a queue the load is large,
 * points one way, and you can still walk; in a scrum it is the same size, points
 * nowhere, and you cannot. Summed as vectors the two separate themselves -- one
 * cancels, the other adds -- so the push vector's *length* is the fraction of the
 * load that points anywhere at all, and its direction is where.
 *
 * And past a point you stop being able to hold your ground at all. A pedestrian
 * being carried has not chosen to move and is not waiting either, so its patience
 * must not reset: it is still stuck, and if it stopped counting as stuck the
 * pressure holding it there would drop and the whole thing would oscillate.
 *
 * The wander is what a crush looks like from outside. Shoves in a real one do not
 * all line up, and because carrying only happens under load there is no noise
 * anywhere it would not belong.
 */
const PIN_FLOOR = 0.15;

/**
 * How much closer to the goal a tick has to get somebody before it counts as
 * progress rather than as being stuck.
 *
 * `waited` cannot answer this. A pedestrian jammed head-on has a sidestep available
 * that costs less than standing still, and taking it clears `waited` -- so it
 * shuffles on the spot indefinitely, looking busy, with the patience everything else
 * keys off never accumulating. This counts getting closer rather than moving.
 */
export const STALL_PROGRESS = 0.5;

/**
 * Restlessness: the fidget of somebody who has been getting nowhere for a while.
 *
 * Two pedestrians in a symmetric standoff evaluate identical options and choose
 * identically, for ever. Every crowd model needs a way out of that and this one had
 * exactly one -- the jiggle in `escapeStep` -- which is reachable only when the
 * navigation cannot find a route at all. A pedestrian that is thoroughly stuck but
 * perfectly well routed, which is the interesting case, could never reach it.
 *
 * Deliberately not `Math.random`. The wobble is a hash of where the pedestrian is
 * standing, how long it has been stuck and which way it is considering, so a run is
 * still reproducible tick for tick -- several tests depend on that -- while two
 * pedestrians in the same predicament still break their tie differently, because
 * they are never in the same place.
 */
const NUDGE_AFTER = 12;
const NUDGE = 0.45;

/**
 * How far off a straight line somebody wanders, and over what distance.
 *
 * Nobody walks a ruler line. The path is a function of where the pedestrian is
 * rather than of the clock, so each traces a fixed gentle S through the room and
 * retraces it if sent back -- and the two coefficients are deliberately
 * incommensurate, or anybody moving along x + y would find their phase standing
 * still and walk perfectly straight after all.
 */
const W_WANDER = 0.16;
const WANDER_X = 0.031;
const WANDER_Y = 0.017;

/** A repeatable number in [0,1) from three integers. */
function wobble(x: number, y: number, salt: number): number {
  let h = 0x9e3779b9 ^ Math.imul(x | 0, 73856093)
    ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Salts for every other draw in the file, one per independent decision, the way
 * sim/arrivals keeps a seed per question. Each is mixed with `stalled`, the count
 * of ticks spent getting nowhere: it is the one clock that keeps ticking for a
 * pedestrian pinned in place, so a shove refused this tick is a different draw
 * next tick instead of the same refusal for ever. Positions are rounded before
 * hashing so the draw stays put within a pixel.
 */
const CARRY_SALT = 101;
const ESCAPE_DX_SALT = 211;
const ESCAPE_DY_SALT = 223;
const ESCAPE_X_SALT = 227;
const ESCAPE_Y_SALT = 229;
const RANDOM_DX_SALT = 307;
const RANDOM_DY_SALT = 311;

/** The wobble of a pedestrian stuck for `stalled` ticks, keyed to where it stands. */
function stuckWobble(x: number, y: number, stalled: number, salt: number): number {
  return wobble(Math.round(x), Math.round(y), salt + stalled * 331);
}
/**
 * Calibrated, not guessed. The load a crowd actually reaches is much smaller than
 * it looks: nought in a crowd with room to walk in, 1.6 at the worst of a busy
 * corridor, 3.1 at the front of a deep crush against a gap. This sits between the
 * last two, so a corridor never shoves anybody and a crush always does.
 */
const CARRY_FROM = 2.5;
const CARRY_WANDER = 0.5;

/**
 * Giving up: the one thing a pedestrian here can do that is not walking.
 *
 * Everything else in this file is about getting through. A pedestrian under load
 * slows, gives up room, sidesteps, queues, and past CARRY_FROM stops deciding
 * anything at all and is moved by the crowd -- but it never stops being aimed at
 * its goal, so the only way out of a bad jam is through it. A crowd pinned against
 * an opening therefore stays pinned: the front rank cannot advance and the back
 * rank has no reason to stop pushing, and the jam has no drain.
 *
 * Real people leave. Someone squeezed long enough abandons the attempt, backs out
 * to somewhere with room in it, waits, and comes back when the press has thinned.
 * That is a release valve the model did not have, and it is what turns a permanent
 * arch at a bottleneck into one that builds, sheds a few people off the back, and
 * clears.
 *
 * SURRENDER_FROM is the same figure as CARRY_FROM, and for the same reason it was
 * calibrated to: the load at which the crowd is moving you rather than you moving
 * is the honest definition of being squeezed. Measured pressure is nought in a
 * crowd with room, ~1.6 at the worst of a busy corridor and ~3.1 at the front of a
 * deep crush, so a corridor never makes anybody give up and a crush eventually
 * makes somebody.
 *
 * SURRENDER_STEPS was tuned against the deep crowd at a gap, which is the case
 * this is for, and against desperation already being in the model. That matters:
 * the ramp unsticks people before a crush can deepen, so pressure there now peaks
 * near 2.8 where it once reached 4.2, and a figure tuned without it fires never.
 * At 60 a 168-strong crush gives up three times, which is not visible; at 25 it
 * gives up ten, every one of which reaches its refuge.
 *
 * The two behaviours are not rivals, and measurement is what says so: the crushed
 * and the stalled turn out to be different people. Pressure peaks at the front of
 * a queue, which is the part that is moving; the stall builds further back, where
 * it is calmer. Gating one on the other was tried and fires nothing at all.
 *
 * RELIEF is 1, so the counter is the plain integral of time spent over the
 * threshold less time spent under it: a squeeze has to be sustained rather than
 * merely survived, but a crush that lets up for a moment is not forgiven twice
 * over. Draining at 2 was tried first and needed a threshold so short -- twelve
 * ticks -- that "for too long" stopped being a fair description of it.
 */
export const SURRENDER_FROM = CARRY_FROM;
const SURRENDER_STEPS = 25;
export const RELIEF = 1;
/**
 * How long the retreat lasts, in ticks: the walk out and the wait at the far end
 * together, because they need no telling apart. A pedestrian standing on its
 * refuge has nothing to gain from any of the nine things it could do, so it stands
 * -- the rest falls out of the step rule and costs no code.
 */
export const FLEE_STEPS = 240;
/**
 * How much longer the assertive hold out, following the other NERVE_ figures: one
 * is somebody who finds a crush an argument to win, nought is somebody who was
 * looking for a way out of it anyway.
 */
const NERVE_RESOLVE = 1.0;

/** Ticks of being squeezed this pedestrian will take before it gives up. */
export function surrenderSteps(assertiveness: number): number {
  return SURRENDER_STEPS * (1 - NERVE_RESOLVE / 2 + NERVE_RESOLVE * assertiveness);
}

/**
 * How far a refuge is judged and how far one may be, both as multiples of the
 * body radius.
 *
 * REFUGE_ROOM is the window "no people" is measured in, and matches PACE_WINDOW:
 * how full a place is, is a question about a wider circle than how pressed one
 * pedestrian feels.
 *
 * REFUGE_REACH is a bound on the whole idea, and a tight one. Backing out of a
 * crush means stepping aside, not crossing the map -- and the far refuge is not
 * merely excessive, it is unreachable. Everyone behind is still walking at the
 * goal, so a long retreat is swum against the entire crowd: at 20 radii, retreats
 * covered about 13px of the 260 they set out to make before their time ran out,
 * and a pedestrian that gives up and then does not go anywhere is worse than one
 * that never gave up.
 */
export const REFUGE_ROOM = 5;
const REFUGE_REACH = 10;
/**
 * How the ground behind is sampled: this many directions fanned across an arc
 * centred on straight back, at this many distances along each.
 *
 * Sampled rather than taken from the visibility graph, which was the first thing
 * tried and does not work. Graph nodes sit on the corners of obstacles, so on the
 * map that most needs this -- a crowd driving at a gap -- every candidate is a
 * corner of the gap itself: the jam, not a way out of it. Worse, they are all
 * nearer the goal along the route than the queue behind them, so the one filter
 * that matters rejected the lot and the behaviour never fired where it was for.
 *
 * A half turn is the most it could be -- the other half is the direction of the
 * goal, and a refuge towards the goal is not a refuge but the thing this
 * pedestrian has just stopped being able to do under a different name. REFUGE_ARC
 * narrows it further, and the narrowing is a trade with a measured middle. At the
 * full half turn the fan reaches straight sideways, and a sideways escape is a
 * real escape that gains nothing on the goal: only twelve retreats in seventeen
 * ended further from it. Wound in to a third of a turn either side, all of them
 * do -- but the fan no longer reaches the flank, which is often the only place
 * with room in it, and three in ten then arrive somewhere no emptier. At 0.7 both
 * hold: every retreat reaches its refuge and finds room there, and four in five
 * gain ground on the goal as well.
 */
const REFUGE_ARCS = 13;
const REFUGE_RANGES = 5;
/** How much of a half turn the fan covers; 1 is the full one. */
const REFUGE_ARC = 0.7;
/**
 * What makes one refuge better than another. Room comes first and is a bar rather
 * than a weight (see REFUGE_EMPTY); between the places that clear it, what decides
 * is how much ground the move gains on the goal.
 *
 * Ground gained on the goal, and not distance walked, which was the first form and
 * is a different thing. The fan reaches sideways as well as back, and a long walk
 * across the queue's flank covers plenty of ground while ending exactly as far
 * from the goal as standing still would -- so scored on distance walked, half the
 * refuges chosen were not away from anything. Scored on what was actually asked
 * for, that goes to four in five.
 */
const W_REFUGE_CROWD = 1.0;
const W_REFUGE_WALK = 0.5;
/**
 * How much emptier than here a refuge has to be.
 *
 * There has to be a bar. Without one the best candidate wins whether or not it is
 * any good, so a pedestrian with nowhere to go gives up anyway and walks into
 * whatever is behind it -- two crowds meeting head-on in a corridor have no room
 * anywhere, every refuge is just more crowd, and three of sixty then never
 * arrived. Having nowhere to go has to be answered by not giving up, and it costs
 * nothing to answer it that way: somebody with no way out and no way back is
 * exactly who the desperation ramp is for.
 *
 * But the bar has to be relative, and the first one was not. "At most one other
 * person within five radii" sounds like a modest ask and is not: it means
 * deserted, and it is unreachable anywhere a crowd is actually deep. On a busy
 * map -- four doors, six hundred people, jams against every corner -- it rejected
 * every candidate for every pedestrian, all eleven hundred of them, and the whole
 * behaviour never fired once while the crush counter ran past nine hundred.
 * Judged against here instead, that same map has refuges everywhere: standing
 * with three people near you beside a jam of fourteen is relief, and calling it
 * one because it is not solitude is how a valve rusts shut.
 *
 * Relative also keeps the promise the absolute bar was bought for, and keeps it
 * for the right reason rather than by accident. Where there is genuinely nowhere
 * to go, nowhere is emptier than here by any margin, so nobody gives up -- and
 * that now holds at whatever density the map runs at, instead of only at the one
 * the figure was picked against.
 */
const REFUGE_RELIEF = 0.5;
const REFUGE_CAP = 3;

/**
 * How much of its own weight a pedestrian can still put behind a lean.
 *
 * Guarded at nought pressure because an unloaded pedestrian has no push vector at
 * all, and without the guard the freest one in the crowd would score as the most
 * pinned and a queue would never form.
 */
function gripOf(a: Agents, j: number): number {
  const p = a.pressure[j];
  if (p <= 0) return 1;
  const coherence = Math.hypot(a.pushX[j], a.pushY[j]);
  const blended = coherence + (1 - coherence) / (1 + p / PRESSURE_HALF);
  return PIN_FLOOR + (1 - PIN_FLOOR) * blended;
}

/**
 * How hard a party holds together, and how close is close enough.
 *
 * Four things keep this from fighting everything else in the file. It is exactly
 * nought inside the formation distance -- not small, nought -- so it can never draw
 * anybody towards contact and the spacing rules have that range to themselves. It
 * is divided by how many companions are in sight, so a party of six pulls each
 * member towards where the party is rather than six times as hard as a pair does.
 * It is capped well under the weight of getting out of somebody's way. And it only
 * applies between people bound for the same place: two painted side by side and
 * then sent to opposite walls are not a party, they are a collision, and pulling
 * them together would fight the very lane formation the opposing weight produces.
 */
const W_PARTY = 1.0;
const FORMATION = 0.5;

/** How much of its own load a pressed pedestrian passes to the one in front. */
const TRANSMIT = 0.8;
/** A ceiling, so a deep enough crowd cannot run the figure away. */
const PRESSURE_MAX = 40;
/** Neighbours close by that count as room enough, before compression starts. */
const FREE_NEIGHBOURS = 2;
/**
 * The window density is judged in, as a multiple of the body radius.
 *
 * Deliberately not the interaction reach. That grows with the personal-space
 * setting, so counting neighbours inside it would find more of them exactly when
 * the setting was raised -- compressing precisely as hard as the setting had
 * loosened, and leaving the dial doing nothing at all.
 */
const DENSITY_WINDOW = 3;
/**
 * The wider window pace is judged in, also as a multiple of the body radius.
 *
 * Wider than the one above, and it has to be. Personal space is judged at arm's
 * reach because that is where being crowded starts to feel like something; but a
 * crowd that has settled into the spacing these rules give it sits *outside* arm's
 * reach almost everywhere, so a count taken there reads about one neighbour whether
 * the corridor is busy or nearly empty. Pace needs to know how full the place is,
 * not how pressed one pedestrian feels, and that is a question about a wider circle.
 */
export const PACE_WINDOW = 5;

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
export function interactionReach(radius: number, personalSpace: number, speed: number): number {
  return 2 * radius + personalSpace + LOOKAHEAD + Math.max(0, speed) * (1 + PACE_SPREAD);
}

export interface StepResult {
  /** Distance covered this tick; 0 for a pedestrian that stood still. */
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
  /** The deepest single pair here, and at the candidate last measured. */
  private hereWorst = 0;
  private worstThere = 0;
  /** Which way discomfort increases, and how steeply. */
  private gradX = 0;
  private gradY = 0;
  /** How much oncoming traffic there is to pass. */
  private oncoming = 0;
  /** How far this pedestrian's body will give, at the load it is currently under. */
  private squash = 0;

  /**
   * Everything about the neighbourhood that does not depend on which way the
   * pedestrian steps, in one pass.
   *
   * The discomfort field is summarised by its value's *gradient* rather than
   * sampled per candidate. A candidate is at most one tick's travel from here --
   * a few pixels against a falloff length of a dozen or more -- so the
   * first-order term is nearly the whole story, and the constant part is shared
   * by all nine and cancels out of the comparison. That turns nine passes over
   * the neighbours into one.
   */
  private survey(self: number, radius: number, personalSpace: number): void {
    const a = this.agents;
    const reach = interactionReach(radius, personalSpace, this.speed);
    const found = this.hash.query(a.x[self], a.y[self], reach, self, a.x, a.y);
    const n = found.length;
    if (this.bodyIdx.length < n) this.bodyIdx = new Int32Array(n * 2);

    // How much room this pedestrian is asking for: its own temperament, relaxed by
    // how crowded it is here, and given up under enough load from behind. The load
    // is last step's -- it is measured by the same pass that would need it, and one
    // tick at sixty a second is not something anyone can see.
    const load0 = a.pressure[self];
    const shove = shoveOf(nerveOf(a, self));
    const pressed = 1 / (1 + load0 / PRESSURE_HALF);
    // What being leaned on costs a body, rather than what it costs a preference.
    // The pushy need far less of a crush before they start squeezing in, but they
    // still need some: nobody earns the right to walk through a standing crowd.
    const squashHalf = SQUASH_HALF * (1 - SHOVE_SQUEEZE * shove);
    // A pushy one starts putting a shoulder in at a lighter crush than anybody
    // else, which is the whole of what makes it pushy -- but not at a lighter one
    // than a calm crowd ever reaches, or the promise above stops being a promise.
    const crushed = Math.max(0, load0 - SQUASH_ONSET * (1 - SHOVE_ONSET * shove));
    this.squash = SQUASH_MAX * radius * (crushed / (crushed + squashHalf));
    const densityWindow2 = (DENSITY_WINDOW * radius) ** 2;
    const paceWindow2 = (PACE_WINDOW * radius) ** 2;
    let crowd = 0;
    let about = 0;
    for (let k = 0; k < n; k++) {
      const j = found[k];
      if (a.arrived[j]) continue;
      const cx = a.x[j] - a.x[self];
      const cy = a.y[j] - a.y[self];
      const c2 = cx * cx + cy * cy;
      if (c2 < densityWindow2) crowd++;
      if (c2 < paceWindow2) about++;
    }
    const compression = Math.max(
      COMPRESS_FLOOR,
      1 / (1 + Math.max(0, crowd - FREE_NEIGHBOURS) / DENSITY_HALF),
    );
    // Two independent things: how much room this one likes, and how little it
    // minds going without. An assertive pedestrian simply walks closer.
    // Two separate things: how much room this one likes, and whether it is the sort
    // to insist on it. Most of the crowd is not pushy at all and this second factor
    // is exactly 1 for them.
    const wanted = wantedSpace(a.trait[self], personalSpace);
    const space = wanted * Math.max(COMPRESS_FLOOR, Math.min(compression, pressed));
    // Being shoved from behind makes you tolerate the back of the person in front
    // of you. It does not make you willing to walk into somebody coming the other
    // way -- that is not a queue you are in, it is a collision you are having. So
    // the crush only closes up the space kept from people going the same way, and
    // whoever is oncoming is given the room they would have been given anyway.
    //
    // Without this split, pressure quietly dismantles lane formation: two streams
    // that tolerate each other at close range interpenetrate instead of sorting,
    // and counterflow arrivals fell by a third.
    //
    // With one exception, and it is the desperation ramp's: somebody who has
    // been getting nowhere for seconds stops giving the crowd coming the other
    // way more room than it gives its own, and the oncoming bubble eases toward
    // the crushed same-way one in step with the stall. Gated on being stuck
    // rather than on pressure, which is what makes it safe where the global
    // version was not: a flowing stream has nobody desperate in it, so lanes
    // sort exactly as before, and the moment the desperate one moves again the
    // stall decays and the deference comes back.
    const desperation = desperationOf(a, self);
    const open = wanted * compression;
    const openSpace = open + (space - open) * desperation;
    a.effectiveSpace[self] = space;
    a.density[self] = about;
    const bubble = 2 * radius + space;
    const decay = Math.max(1, DECAY_FRACTION * bubble);
    const openBubble = 2 * radius + openSpace;
    const openDecay = Math.max(1, DECAY_FRACTION * openBubble);

    const hx = a.headingX[self];
    const hy = a.headingY[self];
    const facing = hx !== 0 || hy !== 0;
    const contact = 2 * radius;
    // A candidate is at most one tick's travel away -- the fastest anyone walks,
    // capped at a body diameter by the driver -- so nothing further than this
    // can be overlapped by one.
    const bodyReach = contact + Math.min(this.speed * (1 + PACE_SPREAD), contact) + 1;
    const goalSelf = a.goal[self];
    const costSelf = a.costToGoal[self];
    // The other half of the desperate exception above: the extra weight an
    // oncoming stranger commands eases toward what any stranger gets. Toward
    // one and never below it -- a desperate pedestrian treats the opposing
    // crowd like its own, not like something to walk into.
    const opposing = OPPOSING + (1 - OPPOSING) * desperation;

    let bodies = 0;
    let load = 0;
    let loadRaw = 0;
    let carried = 0;
    let pushX = 0;
    let pushY = 0;
    let gx = 0;
    let gy = 0;
    let px2 = 0;
    let py2 = 0;
    let companions = 0;
    const party = a.party[self];
    const formation = 2 * radius + FORMATION * personalSpace;
    let oncoming = 0;
    let here = 0;
    let worst = 0;

    for (let k = 0; k < n; k++) {
      const j = found[k];
      if (a.arrived[j]) continue; // pedestrians that reached their target are ignored

      const trueX = a.x[j] - a.x[self];
      const trueY = a.y[j] - a.y[self];
      const trueD = Math.hypot(trueX, trueY);

      // Bodies, at their real positions: this is what may not be walked into.
      if (trueD < bodyReach) {
        this.bodyIdx[bodies++] = j;
        if (trueD < contact) {
          const into = contact - trueD;
          here += into;
          if (into > worst) worst = into;
        }
      }

      // Everything else judges the neighbour where it is about to be, not where
      // it is. One displacement along its heading is the whole of anticipation:
      // two people converging on the same spot start avoiding it before they
      // arrive, which is how crossing streams weave rather than collide.
      const rx = trueX + a.headingX[j] * LOOKAHEAD;
      const ry = trueY + a.headingY[j] * LOOKAHEAD;
      const d = Math.hypot(rx, ry);
      const sameGoal = a.goal[j] === goalSelf;
      const reachJ = sameGoal ? bubble : openBubble;
      const decayJ = sameGoal ? decay : openDecay;
      if (d < 1e-6 || d >= reachJ) continue;

      let w = costSelf < a.costToGoal[j] ? YIELD_LOW : 1;
      if (!sameGoal) w *= opposing;
      // The other half of the asymmetry: somebody walking at you like they mean it
      // is somebody you give way to, whatever you would have done for anyone else.
      w *= 1 - NERVE_PRESENCE / 2 + NERVE_PRESENCE * nerveOf(a, j);

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

      const e = Math.exp((reachJ - d) / decayJ);
      const scale = W_SPACE * w * e / decayJ;
      gx += scale * ux;
      gy += scale * uy;

      // Keeping up with whoever you came in with.
      if (party >= 0 && sameGoal && a.party[j] === party && trueD > formation) {
        const pull = Math.min(1, (trueD - formation) / formation);
        px2 += pull * (trueX / trueD);
        py2 += pull * (trueY / trueD);
        companions++;
      }

      // Is this one leaning on us? Only somebody held up counts -- a neighbour with
      // room to go round is not pressing, it is walking. Judged on where it wants
      // to be rather than where it is heading, the point being that it is not
      // heading anywhere.
      if (a.waited[j] <= 0) continue;
      const wantX = a.hasWaypoint[j] ? a.waypointX[j] - a.x[j] : a.headingX[j];
      const wantY = a.hasWaypoint[j] ? a.waypointY[j] - a.y[j] : a.headingY[j];
      const wantLen = Math.hypot(wantX, wantY);
      if (wantLen < 1e-6) continue;
      // How squarely its way forward runs through us, and how near it already is.
      const into = -(ux * wantX + uy * wantY) / wantLen;
      if (into <= 0) continue;
      const share = into * (1 - d / reachJ)
        * (1 - NERVE_LEAN / 2 + NERVE_LEAN * nerveOf(a, j));
      const put = share * gripOf(a, j);
      loadRaw += share;
      load += put;
      // The raw share, deliberately: what the back of the crowd is doing has to
      // reach the front whether or not the people between can still push.
      carried += share * a.pressure[j];
      // The shove on us points away from whoever is leaning.
      pushX -= put * ux;
      pushY -= put * uy;
    }

    // Its own load, plus the mean of what its pushers are already carrying. The
    // mean rather than the sum is what keeps a deep crowd bounded: the figure
    // converges along a queue instead of doubling down it.
    a.pressure[self] = loadRaw <= 0
      ? 0
      : Math.min(PRESSURE_MAX, load + TRANSMIT * (carried / loadRaw));
    // Divided by the total load rather than normalised: the length that comes out
    // is how much of the load points anywhere, which is the whole measure of
    // whether this one is being carried or merely crushed.
    a.pushX[self] = loadRaw > 0 ? pushX / loadRaw : 0;
    a.pushY[self] = loadRaw > 0 ? pushY / loadRaw : 0;

    if (companions > 0) {
      gx -= W_PARTY * px2 / companions;
      gy -= W_PARTY * py2 / companions;
    }

    this.bodyCount = bodies;
    this.hereOverlap = here;
    this.hereWorst = worst;
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
    // Working loose is never refused: a pedestrian reducing the total crush is
    // going the right way even if the pair it is nearest to gets no better, and
    // refusing those was enough on its own to leave a bottleneck arched.
    if (there < this.hereOverlap) return true;
    // Squeezing in, though, is capped per *pair* and not on the total. A move that
    // gathers the same total onto one neighbour drives one body much deeper into
    // another while the total reports that nothing happened.
    if (this.worstThere > Math.max(this.squash, this.hereWorst)) return false;
    return there <= this.squash;
  }

  /** Total penetration into other pedestrians at a position; 0 when clear. */
  private agentOverlap(px: number, py: number, radius: number): number {
    const a = this.agents;
    const min = radius * 2;
    let total = 0;
    let worst = 0;
    for (let k = 0; k < this.bodyCount; k++) {
      const j = this.bodyIdx[k];
      const d = Math.hypot(a.x[j] - px, a.y[j] - py);
      if (d < min) { const into = min - d; total += into; if (into > worst) worst = into; }
    }
    this.worstThere = worst;
    return total;
  }

  /**
   * One substep towards `target`: score all nine options -- eight directions
   * and standing still -- and take the cheapest.
   *
   * The directions are the lattice's eight, kept because they are a cheap, even
   * fan to search; but the move along the winner is `len` -- at most a pixel,
   * often a fraction of one -- so positions are continuous even though the
   * search is discrete, and a direction is a direction rather than a geometry:
   * a diagonal travels the same distance as an axis step, where the lattice
   * made it sqrt(2) and priced it accordingly. Every cost below is per unit of
   * distance, which is what makes the same comparison valid at any length.
   */
  stepTowards(i: number, target: Point, radius: number, personalSpace: number, len: number): StepResult {
    const a = this.agents;
    const x = a.x[i];
    const y = a.y[i];

    this.survey(i, radius, personalSpace);

    const distHere = Math.hypot(target[0] - x, target[1] - y);
    // Land on the waypoint rather than orbit it: the last move before a target
    // is however long the distance left is.
    const step = Math.min(Math.max(len, 0), Math.max(distHere, 1e-3));
    const hx = a.headingX[i];
    const hy = a.headingY[i];
    const facing = hx !== 0 || hy !== 0;
    // The right hand of a pedestrian facing h. Screen y runs down, so walking
    // east that is south.
    const rightX = -hy;
    const rightY = hx;
    // Somebody who has been getting nowhere starts trying things.
    const restless = a.stalled[i] > NUDGE_AFTER
      ? NUDGE * Math.min(1, (a.stalled[i] - NUDGE_AFTER) / NUDGE_AFTER)
      : 0;
    // And nobody walks a ruler line.
    const wander = W_WANDER * Math.sin(x * WANDER_X + y * WANDER_Y + a.trait[i] * 6.283);

    // Everything is priced per unit of distance travelled, which is what
    // makes a shallow approach angle come out as weaving: a slanted move
    // must earn its length to beat the straight one. Analytic in the
    // direction, so the same pricing can be asked about any angle -- the
    // eight-way scan below and the refinement after it both call it.
    const priceDir = (ux: number, uy: number): number => {
      const nx = x + ux * step;
      const ny = y + uy * step;
      const gain = distHere - Math.hypot(target[0] - nx, target[1] - ny);
      let cost = -gain / step
        + this.gradX * ux + this.gradY * uy;
      if (facing) {
        cost += W_TURN * (1 - (ux * hx + uy * hy)) / 2;
        // Given a choice, pass the same side everyone else does.
        if (this.oncoming > 0) {
          cost -= W_SIDE * this.oncoming * (ux * rightX + uy * rightY);
        }
        cost -= wander * (ux * rightX + uy * rightY);
      }
      return cost;
    };

    // Standing still is always on the table -- it is the option the original
    // lacked, which is why a blocked pedestrian there could only jiggle. It
    // is also the reference point every other candidate is measured against,
    // so it carries no discomfort term of its own.
    let bestCost = W_WAIT
      * (1 - NERVE_IMPATIENCE / 2 + NERVE_IMPATIENCE * nerveOf(a, i))
      * (1 + a.waited[i] / PATIENCE);
    let bestX = 0;
    let bestY = 0;
    let bestUx = 0;
    let bestUy = 0;
    let moved = false;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const norm = stepLengthOf(dx, dy);
        if (norm === 0) continue;

        const ux = dx / norm;
        const uy = dy / norm;
        const nx = x + ux * step;
        const ny = y + uy * step;
        if (!this.isLegal(nx, ny, radius)) continue;

        let cost = priceDir(ux, uy);
        if (restless > 0) {
          cost += restless * (wobble(
            Math.round(x), Math.round(y), (dx + 1) * 3 + (dy + 1) + a.stalled[i] * 9,
          ) - 0.5);
        }

        if (cost < bestCost) {
          bestCost = cost;
          bestX = nx;
          bestY = ny;
          bestUx = ux;
          bestUy = uy;
          moved = true;
        }
      }
    }

    // The eight-way scan finds the right spoke; the true best direction is
    // usually between two of them, and walking spoke-to-spoke is the last of
    // the lattice's 45-degree robotics. Price the winner's two angular
    // neighbours halfway to the next spokes and slide to the minimum of the
    // parabola through the three -- pure arithmetic, no neighbour loop -- then
    // take the refined landing if it is legal, the winner's if not. Skipped
    // while the fidget is on: its per-spoke wobble is doing the opposite job.
    if (moved && restless <= 0) {
      const spoke = Math.PI / 8;
      const angle = Math.atan2(bestUy, bestUx);
      const low = priceDir(Math.cos(angle - spoke), Math.sin(angle - spoke));
      const high = priceDir(Math.cos(angle + spoke), Math.sin(angle + spoke));
      const curve = low - 2 * bestCost + high;
      if (curve > 1e-9) {
        const off = Math.max(-spoke, Math.min(spoke, (spoke * (low - high)) / (2 * curve)));
        if (off !== 0) {
          const ux = Math.cos(angle + off);
          const uy = Math.sin(angle + off);
          const nx = x + ux * step;
          const ny = y + uy * step;
          if (this.isLegal(nx, ny, radius)) { bestX = nx; bestY = ny; }
        }
      }
    }

    if (!moved) {
      // Standing still is only available to somebody the crowd will let stand.
      this.carryStep(i, radius, step);
      // Waiting, rather than being unable to move: the waypoint is still good, and
      // re-planning one costs a scan of the whole graph.
      a.waited[i] += 1;
      return { length: 0, replan: false };
    }
    return this.commit(i, [bestX, bestY], step, true);
  }

  /**
   * Being moved by the crowd rather than by choice.
   *
   * Past `CARRY_FROM` a pedestrian no longer gets to decide it is staying put: it
   * goes the way the load is pushing, wandering more the harder it is pressed --
   * at most a pixel a tick, because a crush moves people slowly however fast
   * they would rather walk. It deliberately leaves its patience alone: it is
   * still stuck, only somewhere else now.
   */
  private carryStep(i: number, radius: number, len: number): boolean {
    const a = this.agents;
    const px = a.pushX[i];
    const py = a.pushY[i];
    const load = a.pressure[i] * Math.hypot(px, py);
    if (load < CARRY_FROM) return false;

    // A shove in a crush does not travel in a straight line.
    const swing = stuckWobble(a.x[i], a.y[i], a.stalled[i], CARRY_SALT) * 2 - 1;
    const wander = CARRY_WANDER * Math.min(1, load / PRESSURE_MAX) * swing;
    const cos = Math.cos(wander);
    const sin = Math.sin(wander);
    const wx = px * cos - py * sin;
    const wy = px * sin + py * cos;

    const wlen = Math.hypot(wx, wy);
    if (wlen < 1e-6) return false;
    const carry = Math.min(1, len);
    if (carry <= 0) return false;
    const nx = a.x[i] + (wx / wlen) * carry;
    const ny = a.y[i] + (wy / wlen) * carry;
    if (!this.isLegal(nx, ny, radius)) return false;
    // Deliberately not through commit. Patience must keep counting -- it is what
    // tells everybody else this one is held up, and zeroing it would take it
    // straight out of the pressure sum that is moving it, collapsing the load,
    // stopping the shove, and setting the whole crowd lurching on alternate ticks.
    // The heading must not follow either: somebody shoved sideways is not facing
    // sideways, they are facing where they were going and being taken elsewhere.
    a.x[i] = nx;
    a.y[i] = ny;
    a.carries++;
    return true;
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
   * Where to go when you have given up: the nearest place behind it with room in
   * it, and in sight so it can get there without a plan.
   *
   * In sight rather than routed to, because a retreat is not a journey. Someone
   * leaving a crush wants out of it now, and what it can see is exactly what it
   * can reach without one -- which is also why navigation can go on only ever
   * routing towards goals.
   *
   * Null when there is nowhere worth going, and the caller then does not let it
   * give up. Giving up with nowhere to go is worse than not giving up: it would
   * stand a pedestrian still, in the crush, for the length of a retreat.
   */
  chooseRefuge(i: number, radius: number): Point | null {
    const a = this.agents;
    const here: Point = [a.x[i], a.y[i]];
    const room = REFUGE_ROOM * radius;
    const reach = REFUGE_REACH * radius;

    // Which way the goal is: up its own route if it holds one, else the way it
    // has been walking, and failing both the way the crowd is leaning -- which
    // is where it was trying to get to, since being leaned on is what happens to
    // somebody who cannot.
    let gx = a.hasWaypoint[i] ? a.waypointX[i] - a.x[i] : a.headingX[i];
    let gy = a.hasWaypoint[i] ? a.waypointY[i] - a.y[i] : a.headingY[i];
    let len = Math.hypot(gx, gy);
    if (len < 1e-6) { gx = -a.pushX[i]; gy = -a.pushY[i]; len = Math.hypot(gx, gy); }
    if (len < 1e-6) return null;
    gx /= len;
    gy /= len;

    // Where the goal actually is, for measuring ground gained on it. The route
    // direction says which way to walk; it does not say how far away the goal is.
    const [goalX, goalY] = this.nav.goalAnchor(a.goal[i], here) ?? [here[0] + gx * reach, here[1] + gy * reach];
    const goalHere = Math.hypot(here[0] - goalX, here[1] - goalY);
    // What it is escaping, and so what a refuge has to beat.
    const hereCrowd = this.crowdAt(here, room, i);

    let best: Point | null = null;
    let bestScore = Infinity;
    const spread = (Math.PI * REFUGE_ARC) / (REFUGE_ARCS - 1);
    for (let k = 0; k < REFUGE_ARCS; k++) {
      const turn = (k - (REFUGE_ARCS - 1) / 2) * spread;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const dx = -(gx * cos - gy * sin);
      const dy = -(gx * sin + gy * cos);
      for (let r = 1; r <= REFUGE_RANGES; r++) {
        const walk = reach * r / REFUGE_RANGES;
        const p: Point = [
          Math.round(here[0] + dx * walk),
          Math.round(here[1] + dy * walk),
        ];
        if (this.insideAnyWall(p)) continue;
        if (!this.nav.canSee(here, p)) continue;
        const crowd = this.crowdAt(p, room, i);
        // Not a refuge unless it is meaningfully emptier than where it stands.
        if (crowd > hereCrowd * REFUGE_RELIEF || crowd > REFUGE_CAP) continue;
        // Ground gained on the goal, which is the thing asked for, rather than
        // ground covered -- a long walk straight across the queue's flank is the
        // same distance from the goal as standing still was.
        const gained = (Math.hypot(p[0] - goalX, p[1] - goalY) - goalHere) / reach;
        const score = W_REFUGE_CROWD * crowd - W_REFUGE_WALK * gained;
        if (score < bestScore) { bestScore = score; best = p; }
      }
    }
    return best;
  }

  /** How many pedestrians still walking are within `room` of a point. */
  private crowdAt(p: Point, room: number, self: number): number {
    const a = this.agents;
    const found = this.hash.query(p[0], p[1], room, self, a.x, a.y);
    let n = 0;
    for (let k = 0; k < found.length; k++) if (!a.arrived[found[k]]) n++;
    return n;
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
  escapeStep(i: number, radius: number, personalSpace: number): StepResult {
    const a = this.agents;
    const here: Point = [a.x[i], a.y[i]];
    const depth = this.penetration(here);

    if (depth === 0) return this.randomStep(i, radius, personalSpace);

    // Head for the nearest way out, with a hashed tie-break so a pedestrian
    // pinned exactly on an axis still works itself loose.
    const stuck = a.stalled[i];
    const target = this.outwardFrom(here);
    let dx = 0;
    let dy = 0;
    if (target) {
      dx = Math.sign(Math.round(target[0] - here[0]));
      dy = Math.sign(Math.round(target[1] - here[1]));
    }
    if (dx === 0 && dy === 0) {
      dx = Math.floor(stuckWobble(here[0], here[1], stuck, ESCAPE_DX_SALT) * 3) - 1;
      dy = Math.floor(stuckWobble(here[0], here[1], stuck, ESCAPE_DY_SALT) * 3) - 1;
    }

    const candidates: Point[] = [
      [here[0] + dx, here[1] + dy],
      [here[0] + dx, here[1]],
      [here[0], here[1] + dy],
      [here[0] + (stuckWobble(here[0], here[1], stuck, ESCAPE_X_SALT) < 0.5 ? 1 : -1), here[1]],
      [here[0], here[1] + (stuckWobble(here[0], here[1], stuck, ESCAPE_Y_SALT) < 0.5 ? 1 : -1)],
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
  randomStep(i: number, radius: number, personalSpace: number): StepResult {
    const a = this.agents;
    const dx = Math.floor(stuckWobble(a.x[i], a.y[i], a.stalled[i], RANDOM_DX_SALT) * 3) - 1;
    const dy = Math.floor(stuckWobble(a.x[i], a.y[i], a.stalled[i], RANDOM_DY_SALT) * 3) - 1;
    if (dx === 0 && dy === 0) return NO_STEP;
    const nx = a.x[i] + dx;
    const ny = a.y[i] + dy;
    this.survey(i, radius, personalSpace);
    if (!this.isLegal(nx, ny, radius)) return NO_STEP;
    return this.commit(i, [nx, ny], stepLengthOf(dx, dy), true);
  }

  private commit(i: number, to: Point, length: number, replan: boolean): StepResult {
    const a = this.agents;
    const dx = to[0] - a.x[i];
    const dy = to[1] - a.y[i];
    a.x[i] = to[0];
    a.y[i] = to[1];
    a.waited[i] = 0;

    // Follow the steps actually taken, so the heading survives a sidestep without
    // swinging to meet it. It is what "in front of me" means everywhere above.
    //
    // The smoothing was tuned per pixel of travel back when every step was one,
    // so it is applied per pixel still: a long move turns the heading as far as
    // the same distance walked in single steps used to, and a fractional drift
    // turns it proportionally less, instead of every move counting the same.
    const alpha = 1 - Math.pow(1 - HEADING_SMOOTH, length);
    const hx = a.headingX[i] + (dx / length - a.headingX[i]) * alpha;
    const hy = a.headingY[i] + (dy / length - a.headingY[i]) * alpha;
    const mag = Math.hypot(hx, hy);
    if (mag > 1e-6) { a.headingX[i] = hx / mag; a.headingY[i] = hy / mag; }

    return { length, replan };
  }
}
