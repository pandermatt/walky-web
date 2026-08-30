import type { Agents } from './agents';
import { PACE_WINDOW } from './behaviour';
import { mpsFromPxPerTick, personsPerM2, TICKS_PER_SECOND } from './units';

/**
 * What the crowd measures about itself.
 *
 * Everything realism-shaped in this project used to be answerable only by
 * writing a test: is the crowd walking at a human pace, how packed is the
 * corridor, how many are actually getting through the door? These are the three
 * numbers the pedestrian literature reports -- speed in metres per second,
 * density in persons per square metre, flow in persons per second -- read off
 * the state the model already keeps, so a run can be compared against published
 * data (Weidmann's 1.34 m/s free speed, the fundamental diagram) while it walks.
 *
 * Nothing here feeds back into behaviour. The crowd cannot see its own readout,
 * so switching the metrics off, or on, changes no run by a single pixel -- the
 * determinism suite would catch it if it did.
 */

/** Flow is judged over the last five seconds, long enough to smooth a burst. */
export const THROUGHPUT_WINDOW_TICKS = 5 * TICKS_PER_SECOND;

/** Fundamental-diagram bins, in persons per square metre. */
export const FD_BIN_WIDTH = 0.25;
const FD_BINS = 32;

/** How often the diagram takes a sample; every tick would be 60 copies of one fact. */
export const FD_EVERY = 10;

export interface FdBin {
  /** Centre of the density bin, persons/m². */
  density: number;
  /** Mean walking speed observed at that density, m/s. */
  speed: number;
  /** How many pedestrian-ticks the mean is over. */
  samples: number;
}

export interface Readout {
  /** Mean walking speed of everybody still going, m/s, over the flow window. */
  meanSpeedMps: number;
  /** Mean and worst crowding around a walker, persons/m². */
  meanDensity: number;
  maxDensity: number;
  /** Arrivals per second over the last five seconds. */
  throughputPerSecond: number;
}

export class Metrics {
  /** Arrivals, distance walked and walkers per tick, over the flow window. */
  private arrivalsRing = new Float64Array(THROUGHPUT_WINDOW_TICKS);
  private movedRing = new Float64Array(THROUGHPUT_WINDOW_TICKS);
  private walkersRing = new Float64Array(THROUGHPUT_WINDOW_TICKS);
  private at = 0;
  private seen = 0;

  private fdSpeedSum = new Float64Array(FD_BINS);
  private fdSamples = new Float64Array(FD_BINS);

  private lastMeanDensity = 0;
  private lastMaxDensity = 0;
  private ticks = 0;

  /** Forgets the run, for a Reset or a cleared map. */
  reset(): void {
    this.arrivalsRing.fill(0);
    this.movedRing.fill(0);
    this.walkersRing.fill(0);
    this.at = 0;
    this.seen = 0;
    this.fdSpeedSum.fill(0);
    this.fdSamples.fill(0);
    this.lastMeanDensity = 0;
    this.lastMaxDensity = 0;
    this.ticks = 0;
  }

  /**
   * Reads one tick off the crowd. Call straight after `Agents.step`, while
   * `justArrived` still holds the tick's arrivals and before any removal
   * shuffles the slots.
   */
  sample(agents: Agents, radiusPx: number): void {
    const windowPx = PACE_WINDOW * radiusPx;
    let moved = 0;
    let walkers = 0;
    let densitySum = 0;
    let densityMax = 0;
    const takeFd = this.ticks % FD_EVERY === 0;

    for (let i = 0; i < agents.count; i++) {
      if (agents.arrived[i] || agents.goal[i] < 0) continue;
      walkers++;
      moved += agents.stepDist[i];
      const d = personsPerM2(agents.density[i], windowPx);
      densitySum += d;
      if (d > densityMax) densityMax = d;
      if (takeFd) {
        const bin = Math.min(FD_BINS - 1, Math.floor(d / FD_BIN_WIDTH));
        this.fdSpeedSum[bin] += mpsFromPxPerTick(agents.stepDist[i]);
        this.fdSamples[bin] += 1;
      }
    }

    this.arrivalsRing[this.at] = agents.justArrived.length;
    this.movedRing[this.at] = moved;
    this.walkersRing[this.at] = walkers;
    this.at = (this.at + 1) % THROUGHPUT_WINDOW_TICKS;
    if (this.seen < THROUGHPUT_WINDOW_TICKS) this.seen++;

    this.lastMeanDensity = walkers > 0 ? densitySum / walkers : 0;
    this.lastMaxDensity = densityMax;
    this.ticks++;
  }

  readout(): Readout {
    let arrivals = 0;
    let moved = 0;
    let walkerTicks = 0;
    for (let t = 0; t < this.seen; t++) {
      arrivals += this.arrivalsRing[t];
      moved += this.movedRing[t];
      walkerTicks += this.walkersRing[t];
    }
    const seconds = this.seen / TICKS_PER_SECOND;
    return {
      meanSpeedMps: walkerTicks > 0 ? mpsFromPxPerTick(moved / walkerTicks) : 0,
      meanDensity: this.lastMeanDensity,
      maxDensity: this.lastMaxDensity,
      throughputPerSecond: seconds > 0 ? arrivals / seconds : 0,
    };
  }

  /** The speed-against-density curve the run has traced so far. */
  fundamentalDiagram(): FdBin[] {
    const out: FdBin[] = [];
    for (let b = 0; b < FD_BINS; b++) {
      if (this.fdSamples[b] === 0) continue;
      out.push({
        density: (b + 0.5) * FD_BIN_WIDTH,
        speed: this.fdSpeedSum[b] / this.fdSamples[b],
        samples: this.fdSamples[b],
      });
    }
    return out;
  }
}
