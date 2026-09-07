import { describe, it, expect } from 'vitest';
import { QUEUE_MAX, TICKS_PER_SECOND, burstAt } from '../sim/arrivals';
import type { Point } from '../sim/geometry';

/** Every clump a door lets out over `beats`, and how long that took. */
function run(at: Point, rate: number, beats: number) {
  const sizes: number[] = [];
  const gaps: number[] = [];
  for (let beat = 0; beat < beats; beat++) {
    const burst = burstAt(at, beat, rate);
    sizes.push(burst.size);
    gaps.push(burst.gap);
  }
  const people = sizes.reduce((a, b) => a + b, 0);
  const ticks = gaps.reduce((a, b) => a + b, 0);
  return { sizes, gaps, people, ticks, perSecond: (people / ticks) * TICKS_PER_SECOND };
}

const DOOR: Point = [240, -80];

describe('the clumps a door lets out', () => {
  /**
   * The reason it is a hash and not `Math.random`: reset replays the same demand,
   * so a layout can be changed and tried again under the flow it failed under.
   */
  it('is the same schedule every time, for a given door', () => {
    expect(burstAt(DOOR, 7, 4)).toEqual(burstAt(DOOR, 7, 4));
    expect(run(DOOR, 4, 50).sizes).toEqual(run(DOOR, 4, 50).sizes);
  });

  it('is a different one for the door next to it, and for the next clump along', () => {
    const here = run(DOOR, 4, 200).sizes;
    const there = run([DOOR[0] + 40, DOOR[1]], 4, 200).sizes;
    expect(there).not.toEqual(here);
    // Two doors on the same map must not fire in lockstep either.
    const together = here.filter((size, i) => size === there[i]).length;
    expect(together).toBeLessThan(here.length * 0.6);
    expect(burstAt(DOOR, 7, 4)).not.toEqual(burstAt(DOOR, 8, 4));
  });

  /** What the slider promises. It is an average now, but it is still the truth. */
  it('averages out at the rate it was asked for, at either end of the slider', () => {
    for (const rate of [1, 4, 20]) {
      expect(run(DOOR, rate, 20_000).perSecond).toBeGreaterThan(rate * 0.94);
      expect(run(DOOR, rate, 20_000).perSecond).toBeLessThan(rate * 1.06);
    }
  });

  /**
   * The thing being asked for: not a metronome. Ones and twos most of the time,
   * fives unremarkable, and a ten every so often.
   */
  it('comes in clumps, mostly small and sometimes not', () => {
    const { sizes } = run(DOOR, 4, 5_000);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(5);

    expect(sizes.filter((s) => s === 1).length).toBeGreaterThan(sizes.length * 0.15);
    expect(sizes.filter((s) => s >= 10).length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBe(1);
    // Capped, because a door is a door however long the tail of the draw is.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
    expect(sizes.every((s) => Number.isInteger(s))).toBe(true);
  });

  /** And gaps between them, which is the "then nothing for a bit" half. */
  it('leaves whole ticks between clumps, at least one and never a dead door', () => {
    const { gaps } = run(DOOR, 4, 5_000);
    expect(gaps.every((g) => Number.isInteger(g) && g >= 1)).toBe(true);

    // Lively by default: at four a second the usual pause is under a second, so
    // the door reads as busy rather than as intermittent.
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(median).toBeLessThan(TICKS_PER_SECOND);
    // With real pauses in it, which is the half being asked for here.
    expect(gaps.filter((g) => g > 2 * TICKS_PER_SECOND).length).toBeGreaterThan(0);
    // And never a stretch long enough to read as a door that has stopped.
    expect(Math.max(...gaps)).toBeLessThan(10 * TICKS_PER_SECOND);
  });

  /**
   * The reason the mean clump is a ceiling rather than a constant.
   *
   * A clump costs the door about `size / rate` seconds of quiet afterwards, so a
   * slow door handing out the same clumps as a busy one would stand still for the
   * better part of a minute at the slider's minimum -- which is a door that has
   * stopped, not a door that is quiet. It hands out about a second's worth
   * instead, and keeps the same rhythm as every other setting.
   */
  it('hands out smaller clumps when it is slow, rather than longer silences', () => {
    const slow = run(DOOR, 1, 5_000);
    const mean = slow.sizes.reduce((a, b) => a + b, 0) / slow.sizes.length;
    expect(mean).toBeLessThan(2.5);
    expect(Math.max(...slow.gaps)).toBeLessThan(25 * TICKS_PER_SECOND);
    const median = [...slow.gaps].sort((a, b) => a - b)[Math.floor(slow.gaps.length / 2)];
    expect(median).toBeLessThan(2 * TICKS_PER_SECOND);
  });

  /** A big clump is worth a longer lull, which is what keeps the rate honest. */
  it('waits longer after a bigger clump', () => {
    const { sizes, gaps } = run(DOOR, 4, 4_000);
    const after = (want: (size: number) => boolean) => {
      const picked = gaps.filter((_, i) => want(sizes[i]));
      return picked.reduce((a, b) => a + b, 0) / picked.length;
    };
    expect(after((s) => s >= 8)).toBeGreaterThan(after((s) => s <= 2));
  });

  it('holds no more than a few clumps behind the door', () => {
    // Not arithmetic so much as the shape of a queue: a door jammed for a minute
    // must not answer the moment it clears by emptying a minute into the gap.
    expect(QUEUE_MAX).toBeGreaterThan(8);
    expect(QUEUE_MAX).toBeLessThan(30);
  });
});
