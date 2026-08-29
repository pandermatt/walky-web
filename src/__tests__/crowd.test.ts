import { describe, it, expect } from 'vitest';
import { Agents, packRgb } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { Navigation } from '../sim/navigation';
import { makeWall, rectanglePolygon } from '../state/model';
import { BLACK, type RGB } from '../palette';

/**
 * What the crowd looks like, rather than whether it arrives.
 *
 * behaviour.test.ts covers the invariants -- nobody overlaps, nobody enters a
 * wall, everybody gets there. None of that distinguishes a crowd that walks from
 * one that shoves its way across the map, which is exactly the failure these
 * cover: with the ported step rule, raising the preferred space made the crowd
 * worse, and every assertion in the older file stayed green while it did.
 *
 * The simulation is deterministic for these scenarios -- the only randomness is
 * the wall-escape jiggle, which none of them reach -- so the thresholds are set
 * close to measured behaviour rather than left loose.
 */

const R = 13;

/** A walled corridor with a goal at the east end. */
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

function arrivedCount(a: Agents): number {
  let n = 0;
  for (let i = 0; i < a.count; i++) if (a.arrived[i]) n++;
  return n;
}

/** Mean distance to the nearest other pedestrian still walking. */
function meanNearestGap(a: Agents): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.count; i++) {
    if (a.arrived[i]) continue;
    let best = Infinity;
    for (let j = 0; j < a.count; j++) {
      if (i === j || a.arrived[j]) continue;
      best = Math.min(best, Math.hypot(a.x[i] - a.x[j], a.y[i] - a.y[j]));
    }
    if (best < Infinity) { sum += best; n++; }
  }
  return n ? sum / n : 0;
}

/** Area of the box enclosing everyone still walking. */
function spread(a: Agents): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let n = 0;
  for (let i = 0; i < a.count; i++) {
    if (a.arrived[i]) continue;
    minX = Math.min(minX, a.x[i]); maxX = Math.max(maxX, a.x[i]);
    minY = Math.min(minY, a.y[i]); maxY = Math.max(maxY, a.y[i]);
    n++;
  }
  return n < 2 ? 0 : (maxX - minX) * (maxY - minY);
}

/** Walks a corridor crowd and reports what it did on the way. */
function walkCorridor(preferred: number, ticks = 900) {
  const { nav, goal } = corridor();
  const agents = new Agents();
  const hash = new SpatialHash();
  block(agents, goal.id, goal.color, 10, 8, -420, -119, 34);

  const startSpread = spread(agents);
  const lastX = new Float32Array(agents.count);
  const lastY = new Float32Array(agents.count);
  const prevX = new Float32Array(agents.count);
  const prevY = new Float32Array(agents.count);
  for (let i = 0; i < agents.count; i++) { prevX[i] = agents.x[i]; prevY[i] = agents.y[i]; }

  let moves = 0;
  let reversals = 0;
  let gapSum = 0;
  let gapN = 0;
  let worstSpread = 0;
  let everWaited = false;

  for (let t = 0; t < ticks; t++) {
    agents.step(nav, hash, 4, R, preferred);
    for (let i = 0; i < agents.count; i++) {
      if (agents.waited[i] > 0) everWaited = true;
      if (agents.arrived[i]) continue;
      const dx = agents.x[i] - prevX[i];
      const dy = agents.y[i] - prevY[i];
      if (dx !== 0 || dy !== 0) {
        if (lastX[i] !== 0 || lastY[i] !== 0) {
          moves++;
          if (dx * lastX[i] + dy * lastY[i] < 0) reversals++;
        }
        lastX[i] = dx; lastY[i] = dy;
      }
      prevX[i] = agents.x[i]; prevY[i] = agents.y[i];
    }
    if (t % 10 === 0) {
      const g = meanNearestGap(agents);
      if (g > 0) { gapSum += g; gapN++; }
      worstSpread = Math.max(worstSpread, spread(agents));
    }
  }

  return {
    agents,
    count: agents.count,
    arrived: arrivedCount(agents),
    meanGap: gapN ? gapSum / gapN : 0,
    spreadGrowth: worstSpread / startSpread,
    reversalRate: moves ? reversals / moves : 0,
    everWaited,
  };
}

describe('preferred space', () => {
  it('widens the crowd without breaking it', () => {
    // The complaint this whole model exists to answer. Under the ported rule the
    // preferred space was also the radius at which a pedestrian stopped
    // navigating, so turning it up did widen the gaps -- by scattering the crowd
    // and stranding a third of it. Room and arrival have to move together.
    const tight = walkCorridor(20);
    const loose = walkCorridor(80);

    expect(loose.meanGap).toBeGreaterThan(tight.meanGap + 10);
    expect(tight.arrived).toBe(tight.count);
    expect(loose.arrived).toBe(loose.count);
  });

  it('does not scatter the crowd across the map', () => {
    // The ported rule spread this crowd over 24x its own footprint at a preferred
    // space of 80: pedestrians pushing away from each other with nothing pulling
    // them back towards the goal.
    for (const preferred of [20, 50, 80]) {
      const run = walkCorridor(preferred);
      expect(run.spreadGrowth).toBeLessThan(5);
    }
  });

  it('is what a pedestrian asks for, not what it insists on', () => {
    // The fundamental diagram: people accept less room as it gets crowded, and
    // take it back when the crush lifts. It is what stops a high setting from
    // being a demand the space cannot meet -- rather than a crowd trying to hold
    // 80px apart in a place that has not got it, and settling the shortfall by
    // shoving, the asking price itself comes down.
    //
    // Every reading is a mean over sixteen or more pedestrians. How much room one
    // of them wants is partly its own temperament, so a single agent measures that
    // as much as it measures the crowding, and two means are the only fair
    // comparison.
    const goal = makeWall([rectanglePolygon([3000, -200], [3100, 200])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([goal], R);
    const setting = 80;

    const kept = (pitch: number, n: number, ticks: number) => {
      const agents = new Agents();
      const hash = new SpatialHash();
      block(agents, goal.id, goal.color, n, n, -1000, -((n * pitch) / 2), pitch);
      for (let t = 0; t < ticks; t++) agents.step(nav, hash, 4, R, setting);
      let sum = 0;
      let seen = 0;
      for (let i = 0; i < agents.count; i++) {
        if (agents.effectiveSpace[i] > 0) { sum += agents.effectiveSpace[i]; seen++; }
      }
      return sum / seen;
    };

    // Far enough apart to be out of each other's world entirely.
    const alone = kept(300, 4, 5);
    // Packed tighter than two radii and a preferred space put together.
    const packed = kept(27, 10, 5);
    // The same crowd, once it has had room to open out.
    const relaxed = kept(27, 10, 30);

    // Left alone, a pedestrian keeps about what the setting says. The spread of
    // temperaments puts the mean a little under it, never over.
    expect(alone).toBeGreaterThan(setting * 0.75);
    expect(alone).toBeLessThanOrEqual(setting);
    // In the crush it asks for a good deal less.
    expect(packed).toBeLessThan(alone * 0.8);
    expect(packed).toBeLessThan(setting * 0.65);
    // And wants it back once there is room, rather than staying compressed.
    expect(relaxed).toBeGreaterThan(packed * 1.2);
  });
});

describe('how the crowd moves', () => {
  it('walks rather than jitters', () => {
    // A step that reverses the one before it is the visible signature of the
    // ported rule, which re-derived a direction from scratch every tick: 13.8% of
    // all moves. The turn penalty is what holds this down.
    const run = walkCorridor(80);
    expect(run.reversalRate).toBeLessThan(0.03);
  });

  it('waits instead of pushing when the way is blocked', () => {
    // Standing still is the option the ported rule lacked -- a blocked pedestrian
    // there could only jiggle at random. Nobody may be squeezed into anyone else
    // while it happens.
    const gapTop = makeWall([rectanglePolygon([0, -400], [40, -40])]);
    const gapBottom = makeWall([rectanglePolygon([0, 40], [40, 400])]);
    const goal = makeWall([rectanglePolygon([220, -30], [280, 30])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([gapTop, gapBottom, goal], R);

    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 8, 8, -340, -140, 40);

    let waited = 0;
    for (let t = 0; t < 600; t++) {
      agents.step(nav, hash, 4, R, 30);
      for (let i = 0; i < agents.count; i++) if (agents.waited[i] > 0) waited++;
      for (let i = 0; i < agents.count; i++) {
        if (agents.arrived[i]) continue;
        for (let j = i + 1; j < agents.count; j++) {
          if (agents.arrived[j]) continue;
          const d = Math.hypot(agents.x[i] - agents.x[j], agents.y[i] - agents.y[j]);
          expect(d).toBeGreaterThanOrEqual(2 * R - 1e-6);
        }
      }
    }
    expect(waited).toBeGreaterThan(0);
    expect(arrivedCount(agents)).toBe(agents.count);
  });

  it('sorts counterflow into lanes', () => {
    // Two streams through one corridor. The ported rule separated them too -- the
    // x100 penalty on a crowd bound elsewhere makes them mutually repulsive -- but
    // never settled who passed on which side. A consistent passing side does.
    //
    // Measured over several layouts, and deliberately not over one. Counterflow is
    // the least reproducible thing this model does: shifting where the crowd is
    // placed by a single pixel, which changes nothing anyone could describe, swings
    // how many get through from 12 of 112 to 102. An earlier version of this test
    // asserted 90% arrival from one layout that happened to land near the top of
    // that range, which measured the layout rather than the model. What survives
    // across layouts is that the streams separate, and that they do not seize up.
    const run = (shift: number) => {
      const top = makeWall([rectanglePolygon([-700, -220], [700, -170])]);
      const bottom = makeWall([rectanglePolygon([-700, 170], [700, 220])]);
      const east = makeWall([rectanglePolygon([620, -160], [700, 160])]);
      const west = makeWall([rectanglePolygon([-700, -160], [-620, 160])]);
      east.isGoal = true;
      west.isGoal = true;
      const nav = new Navigation();
      nav.rebuild([top, bottom, east, west], R);

      const agents = new Agents();
      const hash = new SpatialHash();
      const eastbound: boolean[] = [];
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 8; j++) {
          const k = agents.add([-560 + shift + i * 34, -140 + j * 36]);
          agents.setGoal(k, east.id, east.color);
          eastbound[k] = true;
        }
      }
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 8; j++) {
          const k = agents.add([560 + shift - i * 34, -140 + j * 36]);
          agents.setGoal(k, west.id, west.color);
          eastbound[k] = false;
        }
      }

      let separation = 0;
      for (let t = 0; t < 600; t++) {
        agents.step(nav, hash, 4, R, 30);
        // How far apart the streams sit across the corridor, while both are in it.
        let ey = 0, en = 0, wy = 0, wn = 0;
        for (let i = 0; i < agents.count; i++) {
          if (agents.arrived[i] || Math.abs(agents.x[i]) > 560) continue;
          if (eastbound[i]) { ey += agents.y[i]; en++; } else { wy += agents.y[i]; wn++; }
        }
        if (en > 10 && wn > 10) separation = Math.max(separation, Math.abs(ey / en - wy / wn));
      }
      return { separation, arrived: arrivedCount(agents), count: agents.count };
    };

    const runs = [run(0), run(3), run(5)];
    const mean = (pick: (r: typeof runs[0]) => number) =>
      runs.reduce((sum, r) => sum + pick(r), 0) / runs.length;

    // The streams find their own sides of the corridor rather than mixing.
    expect(mean((r) => r.separation)).toBeGreaterThan(30);
    // And keep going. Some of them get through on every layout, and most do on
    // average -- the ported rule managed 2 of 112.
    for (const r of runs) expect(r.arrived).toBeGreaterThan(r.count * 0.1);
    expect(mean((r) => r.arrived)).toBeGreaterThan(runs[0].count * 0.4);
  });
});

describe('crowd pressure', () => {
  /** A deep crowd all driving at one narrow gap. */
  function crush() {
    const top = makeWall([rectanglePolygon([0, -500], [40, -35])]);
    const bottom = makeWall([rectanglePolygon([0, 35], [40, 500])]);
    const goal = makeWall([rectanglePolygon([260, -40], [340, 40])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([top, bottom, goal], R);
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 14, 12, -560, -209, 38);
    for (let t = 0; t < 300; t++) agents.step(nav, hash, 4, R, 60);
    return agents;
  }

  it('builds along a queue and peaks at the front', () => {
    // The reason pressure exists rather than density alone. A crowd holds the
    // spacing it wants, so the density that would compress that spacing never
    // arises and a queue backed up by a hundred people stands as politely as a
    // queue of three. Being leaned on is not the same as being near.
    const agents = crush();

    // Split whoever is still queuing into the half nearest the gap and the rest.
    const queuing: number[] = [];
    for (let i = 0; i < agents.count; i++) {
      if (!agents.arrived[i] && agents.x[i] < 0) queuing.push(i);
    }
    expect(queuing.length).toBeGreaterThan(20);
    queuing.sort((a, b) => agents.x[a] - agents.x[b]);
    const back = queuing.slice(0, Math.floor(queuing.length / 2));
    const front = queuing.slice(Math.floor(queuing.length / 2));
    const mean = (xs: number[]) => xs.reduce((s, i) => s + agents.pressure[i], 0) / xs.length;

    // Whoever is against the barrier carries the crowd behind them, not just the
    // person behind them -- which is why a crush is dangerous at the front.
    expect(mean(front)).toBeGreaterThan(mean(back) * 1.5);
  });

  it('closes a crowd up that would otherwise queue politely', () => {
    const agents = crush();
    let sum = 0;
    let n = 0;
    for (let i = 0; i < agents.count; i++) {
      if (agents.arrived[i] || agents.x[i] > 0 || agents.effectiveSpace[i] <= 0) continue;
      sum += agents.effectiveSpace[i];
      n++;
    }
    // Against a setting of 60. Without pressure this crowd held 54: density alone
    // barely engaged, because the crowd never got dense enough to trigger it.
    expect(sum / n).toBeLessThan(50);
  });

  it('never presses anybody into anybody else', () => {
    // Pressure lowers what a pedestrian asks for. It does not move it, and bodies
    // do not compress: the no-overlap rule stays absolute however deep the crowd.
    const agents = crush();
    for (let i = 0; i < agents.count; i++) {
      if (agents.arrived[i]) continue;
      for (let j = i + 1; j < agents.count; j++) {
        if (agents.arrived[j]) continue;
        const d = Math.hypot(agents.x[i] - agents.x[j], agents.y[i] - agents.y[j]);
        expect(d).toBeGreaterThanOrEqual(2 * R - 1e-6);
      }
    }
  });
});

describe('assertive and polite pedestrians', () => {
  it('lets the pushy ones wait less than the patient ones', () => {
    // Assertiveness points outward -- at what a pedestrian is to everybody else --
    // with one exception: standing still costs it more. That is the difference
    // between somebody who queues and somebody who gets on with it.
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 10, 8, -420, -119, 34);

    const waited = new Float64Array(agents.count);
    for (let t = 0; t < 500; t++) {
      agents.step(nav, hash, 4, R, 60);
      for (let i = 0; i < agents.count; i++) if (agents.waited[i] > 0) waited[i] += 1;
    }

    const order = [...Array(agents.count).keys()]
      .sort((a, b) => agents.assertiveness[a] - agents.assertiveness[b]);
    const quarter = Math.floor(agents.count / 4);
    const polite = order.slice(0, quarter);
    const pushy = order.slice(-quarter);
    const mean = (xs: number[]) => xs.reduce((s, i) => s + waited[i], 0) / xs.length;

    expect(mean(pushy)).toBeLessThan(mean(polite));
  });
});

describe('crowd state stays sound', () => {
  it('keeps every number finite and every heading a unit vector', () => {
    const run = walkCorridor(80, 400);
    const a = run.agents;
    for (let i = 0; i < a.count; i++) {
      expect(Number.isFinite(a.x[i])).toBe(true);
      expect(Number.isFinite(a.y[i])).toBe(true);
      expect(Number.isFinite(a.effectiveSpace[i])).toBe(true);
      const h = Math.hypot(a.headingX[i], a.headingY[i]);
      // Either it has never stepped, or it is facing somewhere in particular.
      expect(h === 0 || Math.abs(h - 1) < 1e-3).toBe(true);
    }
  });

  it('gives a pedestrian a temperament that survives undo and reset', () => {
    // Traits are derived from where a pedestrian was placed rather than stored,
    // so the undo snapshot stays the four things a map edit can change. That only
    // works if they come back identical.
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 4, 4, -400, -60, 40);
    const before = Array.from(agents.trait.slice(0, agents.count));
    expect(new Set(before).size).toBeGreaterThan(1); // and they are not all alike

    const snap = agents.snapshot();
    for (let t = 0; t < 50; t++) agents.step(nav, hash, 4, R, 30);
    agents.add([900, 900]);
    agents.restore(snap);
    expect(Array.from(agents.trait.slice(0, agents.count))).toEqual(before);

    agents.resetPositions();
    expect(Array.from(agents.trait.slice(0, agents.count))).toEqual(before);
  });

  it('puts a reset crowd back in the colour of the goal it is walking to', () => {
    // Arriving turns a pedestrian black. Reset puts it back at the start, so it
    // must stop looking like one that has already finished -- and it is still
    // bound for the same wall, so it is that wall's colour it goes back to.
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 4, 4, 300, -60, 20);
    for (let t = 0; t < 200; t++) agents.step(nav, hash, 4, R, 30);
    expect(arrivedCount(agents)).toBe(agents.count);
    const black = packRgb(BLACK);
    expect(Array.from(agents.color.slice(0, agents.count))).toEqual(
      new Array(agents.count).fill(black),
    );

    agents.resetPositions(new Map([[goal.id, goal.color]]));
    expect(Array.from(agents.color.slice(0, agents.count))).toEqual(
      new Array(agents.count).fill(packRgb(goal.color)),
    );
  });

  it('gives a reset pedestrian with nowhere to be a fresh colour', () => {
    // Nothing to take a colour from, and the one it has says nothing about where
    // it is going, so it starts over as a new pedestrian does.
    const { goal } = corridor();
    const agents = new Agents();
    const i = agents.add([0, 0], [1, 2, 3]);
    expect(agents.color[i]).toBe(packRgb([1, 2, 3]));

    agents.resetPositions(new Map([[goal.id, goal.color]]));
    expect(agents.color[i]).not.toBe(packRgb([1, 2, 3]));
    expect(agents.color[i]).not.toBe(packRgb(goal.color));
  });

  it('treats a pedestrian whose goal wall is gone as one with nowhere to be', () => {
    const { nav, goal } = corridor();
    const agents = new Agents();
    const hash = new SpatialHash();
    block(agents, goal.id, goal.color, 2, 2, 300, -60, 20);
    for (let t = 0; t < 200; t++) agents.step(nav, hash, 4, R, 30);

    agents.resetPositions(new Map());
    const black = packRgb(BLACK);
    for (let i = 0; i < agents.count; i++) expect(agents.color[i]).not.toBe(black);
  });
});
