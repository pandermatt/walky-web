import { traitOf } from './agents';
import type { Point } from './geometry';

/**
 * When a generator lets people out, and how many at a time.
 *
 * A door paying out one sixtieth of its rate a tick and releasing somebody the
 * moment it has banked a whole one is a metronome, and nobody arrives at a door
 * like that. People come in clumps -- off the same train, out of the same lift,
 * across on the same green man -- so five come through together, then one, then
 * nothing at all for a couple of seconds, then ten.
 *
 * The process is the standard way of saying that: batch arrivals, or compound
 * Poisson. Bursts turn up at random intervals and each has a size of its own,
 * and the two are chosen so that the people per second averages out at exactly
 * what the slider says. The slider goes on meaning what it always meant; what
 * changes is that it is now an average rather than a tick rate.
 *
 * Everything here is a hash rather than `Math.random`, following the rule stated
 * where the fidget is defined in behaviour.ts: what shapes the look of an
 * ordinary run is derived, so a run replays tick for tick and a test can depend
 * on it -- and since the last tie-breaks in behaviour.ts went the same way,
 * nothing anywhere in the model draws from `Math.random` at all, so a whole run
 * is the same run every time. It pays for itself here twice over. Reset replays the same demand
 * through the same door, so two layouts can be compared under one flow instead
 * of under two; and a map that arrives down a link behaves the way it behaved
 * for whoever sent it.
 */

/** Frames a second, which is what a browser hands out when it can keep up. */
export const TICKS_PER_SECOND = 60;

/**
 * How big a clump is on average, and the least it may shrink to.
 *
 * Four is the number the whole thing is tuned around: it makes ones and twos the
 * common case, five unremarkable and ten a thing that happens every so often.
 *
 * It is a ceiling rather than a constant, because a clump is worth `size / rate`
 * seconds of the door's own traffic and the pause after it lasts about that long.
 * At four a second that is a second's pause, which reads as a pause. At one a
 * second it would be four, and a sixteen-person tail would stand the door down
 * for the better part of a minute -- a door that has stopped rather than a door
 * that is quiet. So a slow door hands out small clumps: about a second's worth of
 * whatever it is doing, which keeps the rhythm the same across the slider and
 * only changes how many come through on each beat.
 */
const MEAN_BURST = 4;
const MIN_MEAN_BURST = 1.5;

/** The mean clump for a door running at `rate`: a second's worth, up to four. */
function meanBurstFor(rate: number): number {
  return Math.min(MEAN_BURST, Math.max(MIN_MEAN_BURST, rate));
}

/**
 * The largest clump one draw may ask for.
 *
 * The tail of a geometric distribution is unbounded, and the point of the cap is
 * not the arithmetic -- a burst of eighty would drain in a few seconds anyway --
 * but that a door is a door. Sixteen is already twice what its mouth can hold.
 */
const MAX_BURST = 16;

/**
 * The most people that may be waiting behind a door.
 *
 * A door whose way out is blocked -- the crowd backed up into it, the goal
 * unreachable -- goes on being a door people arrive at, and without a ceiling the
 * queue behind it grows for as long as the jam lasts and then empties into the
 * first gap that appears. Three clumps' worth is about what stands behind a door
 * before the people at the back stop joining.
 */
export const QUEUE_MAX = 3 * MEAN_BURST;

/**
 * How many times its own length an interval may run to, and what cutting it
 * there leaves behind.
 *
 * The intervals want to be exponential, because that is what produces both the
 * two clumps arriving nearly together and the long-feeling pause -- but the
 * exponential has no upper bound, and it is being multiplied by a base that is
 * itself variable. Left uncut, a sixteen-person clump drawing a long interval
 * stands the door down for a quarter of a minute, which reads as broken rather
 * than as quiet.
 *
 * Cut at twice the mean the tail is gone and the texture is not: an interval can
 * still be a tenth of its usual length or twice it. The cut costs about 14% of
 * the average, and the division gives it straight back, so the mean interval is
 * exactly the time those people are worth and the slider keeps its word.
 */
const GAP_CUTOFF = 2;
const GAP_KEPT = 1 - Math.exp(-GAP_CUTOFF);

/**
 * Three independent streams from the one hash: which door, how many, how long
 * until the next. Different seeds, or a door's size and its silence would be the
 * same number wearing two hats.
 */
const DOOR_SEED = 0x1b873593;
const SIZE_SEED = 0xcc9e2d51;
const GAP_SEED = 0x6c078965;

/** A clump: how many come through, and how long the door is then quiet for. */
export interface Burst {
  /** How many arrive together. At least one. */
  size: number;
  /** Ticks until the next burst. At least one, so a door cannot fire twice a tick. */
  gap: number;
}

/**
 * A door's own number, so that no two share a schedule.
 *
 * Taken from where it stands rather than from its id, because an id is minted
 * fresh every time a map is opened -- a shared map would arrive with a different
 * flow through the same door, which is the one thing deriving this instead of
 * storing it was for.
 */
function doorOf(at: Point): number {
  return Math.round(traitOf(at[0], at[1], DOOR_SEED) * 0x7fffffff);
}

/**
 * The `beat`th clump out of the door at `at`, for a door running at `rate`
 * people a second.
 *
 * The size is geometric, which is the shape of "mostly small, occasionally not":
 * one is the commonest answer and every extra person is less likely than the last,
 * with no particular size the distribution is built around.
 *
 * The gap is exponential about `size / rate` seconds -- the time that many people
 * are worth at this rate. Pinning the interval to the size just drawn, rather than
 * to the average size, is what makes the rate true over a handful of bursts
 * instead of only in the very long run, and it reads right as well: a big clump is
 * followed by a longer lull, the way a lift-load is.
 */
export function burstAt(at: Point, beat: number, rate: number): Burst {
  const door = doorOf(at);
  const size = sizeOf(traitOf(beat, door, SIZE_SEED), rate);
  return { size, gap: gapOf(traitOf(beat, door, GAP_SEED), size, rate) };
}

/** A geometric draw with the mean this door's rate calls for, from a uniform in [0,1). */
function sizeOf(u: number, rate: number): number {
  const p = 1 / meanBurstFor(rate);
  const k = 1 + Math.floor(Math.log(1 - u) / Math.log(1 - p));
  return Math.min(MAX_BURST, k);
}

/** An exponential draw about the time `size` people are worth, in whole ticks. */
function gapOf(v: number, size: number, rate: number): number {
  const seconds = size / Math.max(1, rate);
  const spread = Math.min(-Math.log(1 - v), GAP_CUTOFF) / GAP_KEPT;
  return Math.max(1, Math.round(seconds * spread * TICKS_PER_SECOND));
}
