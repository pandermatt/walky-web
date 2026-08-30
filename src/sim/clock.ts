import { STEP_MS } from './units';

/**
 * The accumulator that owes the simulation its sixty steps a second.
 *
 * requestAnimationFrame fires at whatever the display refreshes at, and the loop
 * used to take one simulation step per firing -- so a 120Hz monitor ran the
 * crowd at double speed and a struggling laptop at half. This banks the time
 * that actually passed and pays it out in whole ticks, so the crowd crosses the
 * room in the same number of seconds everywhere.
 *
 * The debt is capped. On a machine too slow to keep up, owed steps pile up
 * faster than they can be paid, and paying them all would mean more work per
 * frame on exactly the machine that cannot afford it -- the spiral of death.
 * Past MAX_SUBSTEPS per frame the remainder is forgiven and simulated time
 * simply runs slower than the wall clock, which is the stance the model always
 * took on slow machines: the crowd and the doors slow down together.
 */
const MAX_SUBSTEPS = 3;

export class Clock {
  private acc = 0;
  private last: number | null = null;

  constructor(
    private readonly stepMs: number = STEP_MS,
    private readonly maxSubsteps: number = MAX_SUBSTEPS,
  ) {}

  /**
   * Forgets where the clock was, so the next frame starts a fresh account.
   * Called whenever the loop stops or the simulation pauses: time spent paused
   * is not owed, and resuming must not open on a burst of catch-up steps.
   */
  reset(): void {
    this.acc = 0;
    this.last = null;
  }

  /**
   * Banks the time since the previous call and returns how many whole steps it
   * buys, at most `maxSubsteps`. The first call after a reset buys exactly one,
   * so pressing play moves the crowd on the very frame it was pressed rather
   * than a frame later.
   */
  advance(nowMs: number): number {
    if (this.last === null) {
      this.last = nowMs;
      return 1;
    }
    this.acc += Math.max(0, nowMs - this.last);
    this.last = nowMs;
    let steps = Math.floor(this.acc / this.stepMs);
    if (steps > this.maxSubsteps) {
      steps = this.maxSubsteps;
      this.acc = 0;
    } else {
      this.acc -= steps * this.stepMs;
    }
    return steps;
  }
}
