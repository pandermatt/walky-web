import { describe, it, expect } from 'vitest';
import { Clock } from '../sim/clock';
import { STEP_MS, TICKS_PER_SECOND, PX_PER_METRE, pxPerTickFromMps, mpsFromPxPerTick, personsPerM2 } from '../sim/units';

/**
 * The accumulator's whole job: sixty steps a second whatever the display does.
 * Each case feeds the clock the frame timestamps a real monitor would and
 * counts the steps it pays out.
 */

function run(clock: Clock, frameMs: number, frames: number, startAt = 0): number {
  let steps = 0;
  for (let f = 0; f < frames; f++) steps += clock.advance(startAt + f * frameMs);
  return steps;
}

describe('the clock', () => {
  it('pays sixty steps a second on a 60Hz display', () => {
    const clock = new Clock();
    // 601 frames at 60Hz = 10 seconds; the first frame's free step evens out.
    const steps = run(clock, 1000 / 60, 601);
    expect(steps).toBeGreaterThanOrEqual(10 * TICKS_PER_SECOND - 1);
    expect(steps).toBeLessThanOrEqual(10 * TICKS_PER_SECOND + 1);
  });

  it('pays sixty steps a second on a 120Hz display, not one twenty', () => {
    const clock = new Clock();
    const steps = run(clock, 1000 / 120, 1201);
    expect(steps).toBeGreaterThanOrEqual(10 * TICKS_PER_SECOND - 1);
    expect(steps).toBeLessThanOrEqual(10 * TICKS_PER_SECOND + 1);
  });

  it('catches up with two steps a frame on a 30Hz display', () => {
    const clock = new Clock();
    clock.advance(0);
    const perFrame: number[] = [];
    for (let f = 1; f <= 60; f++) perFrame.push(clock.advance(f * (1000 / 30)));
    // Every frame owes two ticks, give or take the rounding.
    expect(perFrame.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(118);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(3);
  });

  it('forgives the debt past three steps a frame instead of spiralling', () => {
    const clock = new Clock();
    clock.advance(0);
    // A 10Hz slideshow owes six ticks a frame; only three may be paid, and the
    // rest must be forgotten -- not banked into an ever-growing burst.
    expect(clock.advance(100)).toBe(3);
    expect(clock.advance(200)).toBe(3);
    expect(clock.advance(200 + STEP_MS * 1.01)).toBe(1);
  });

  it('does not burst after a pause', () => {
    const clock = new Clock();
    clock.advance(0);
    clock.advance(1000 / 60);
    clock.reset();
    // Five minutes later: the first frame back buys exactly the play-now step.
    expect(clock.advance(300_000)).toBe(1);
    expect(clock.advance(300_000 + 1000 / 60)).toBe(1);
  });

  it('steps once immediately on the first frame', () => {
    const clock = new Clock();
    expect(clock.advance(12345)).toBe(1);
  });
});

describe('the units', () => {
  it('round-trips a speed through the exchange rate', () => {
    expect(mpsFromPxPerTick(pxPerTickFromMps(1.34))).toBeCloseTo(1.34, 10);
  });

  it('prices the free walking speed at about a pixel and a quarter a tick', () => {
    expect(pxPerTickFromMps(1.34)).toBeCloseTo(1.25, 1);
  });

  it('reads one person alone in a metre-radius window as a third of a person per square metre', () => {
    expect(personsPerM2(1, PX_PER_METRE)).toBeCloseTo(1 / Math.PI, 6);
  });
});
