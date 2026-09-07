import { describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { Navigation } from '../sim/navigation';
import { Metrics, THROUGHPUT_WINDOW_TICKS } from '../sim/metrics';
import { mpsFromPxPerTick, TICKS_PER_SECOND } from '../sim/units';
import { makeWall, rectanglePolygon } from '../state/model';
import type { RGB } from '../palette';

/**
 * The readout must say what the run did -- in the literature's units -- and the
 * fundamental diagram must come out the right way round: the crowded walk
 * slower than the free. The shapes are the ones crowd.test.ts already measures
 * pace in, so the numbers here are the same facts read off a different dial.
 */

const R = 13;

function corridor() {
  const top = makeWall([rectanglePolygon([-500, -260], [500, -200])]);
  const bottom = makeWall([rectanglePolygon([-500, 200], [500, 260])]);
  const goal = makeWall([rectanglePolygon([420, -60], [500, 60])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([top, bottom, goal], R);
  return { nav, goal };
}

function block(agents: Agents, goalId: number, color: RGB,
               cols: number, rows: number, x0: number, y0: number, pitch: number) {
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([x0 + i * pitch, y0 + j * pitch]);
      agents.setGoal(k, goalId, color);
    }
  }
}

describe('the readout', () => {
  it('reads a lone walker at about the free walking pace of the speed setting', () => {
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([-400, 0]);
    agents.setGoal(i, goal.id, goal.color);

    const metrics = new Metrics();
    for (let t = 0; t < 100; t++) {
      agents.step(nav, hash, 4, R, 40);
      metrics.sample(agents, R);
    }

    // A lone pedestrian at speed 4 spends most of its budget every tick; the
    // pace trait and the lattice's whole-step spending keep it under the raw
    // setting but well past half of it.
    const readout = metrics.readout();
    expect(readout.meanSpeedMps).toBeGreaterThan(mpsFromPxPerTick(4) * 0.5);
    expect(readout.meanSpeedMps).toBeLessThanOrEqual(mpsFromPxPerTick(4) * 1.05);
    // Alone means effectively zero persons per square metre.
    expect(readout.meanDensity).toBeLessThan(0.1);
  });

  it('counts arrivals per second over its window', () => {
    const metrics = new Metrics();
    // An empty crowd whose arrival list is scripted by hand: three a tick for
    // one second, then quiet.
    const agents = new Agents();
    const arrivals = agents.justArrived as number[];
    for (let t = 0; t < TICKS_PER_SECOND; t++) {
      arrivals.length = 0;
      arrivals.push(1, 2, 3);
      metrics.sample(agents, R);
    }
    arrivals.length = 0;
    for (let t = 0; t < THROUGHPUT_WINDOW_TICKS - TICKS_PER_SECOND; t++) metrics.sample(agents, R);

    // 180 arrivals over a five-second window is 36 a second.
    expect(metrics.readout().throughputPerSecond).toBeCloseTo(36, 5);

    // Once the burst ages out of the window entirely, the flow reads zero.
    for (let t = 0; t < TICKS_PER_SECOND; t++) metrics.sample(agents, R);
    expect(metrics.readout().throughputPerSecond).toBe(0);
  });

  it('traces a diagram where the crowded walk slower than the free', () => {
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 10, 8, -420, -119, 34);

    const metrics = new Metrics();
    for (let t = 0; t < 400; t++) {
      agents.step(nav, hash, 4, R, 40);
      metrics.sample(agents, R);
    }

    const fd = metrics.fundamentalDiagram();
    expect(fd.length).toBeGreaterThan(1);
    const free = fd.filter((b) => b.density < 0.5);
    const packed = fd.filter((b) => b.density >= 1);
    expect(free.length).toBeGreaterThan(0);
    expect(packed.length).toBeGreaterThan(0);
    const mean = (bins: typeof fd) => {
      let speed = 0;
      let n = 0;
      for (const b of bins) { speed += b.speed * b.samples; n += b.samples; }
      return speed / n;
    };
    expect(mean(packed)).toBeLessThan(mean(free));
  });

  it('changes no run by a single pixel', () => {
    // The crowd must not be able to see its own readout. Two identical runs,
    // one measured and one not, must land everybody on the same spot.
    const walk = (measured: boolean) => {
      const { nav, goal } = corridor();
      const agents = new Agents();
      const hash = new SpatialHash();
      block(agents, goal.id, goal.color, 6, 6, -420, -100, 40);
      const metrics = new Metrics();
      for (let t = 0; t < 200; t++) {
        agents.step(nav, hash, 4, R, 40);
        if (measured) metrics.sample(agents, R);
      }
      const out: number[] = [];
      for (let i = 0; i < agents.count; i++) out.push(agents.x[i], agents.y[i]);
      return out;
    };
    expect(walk(true)).toEqual(walk(false));
  });
});
