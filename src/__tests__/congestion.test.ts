import { describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { Navigation, RECOST_TICKS } from '../sim/navigation';
import { makeWall, rectanglePolygon } from '../state/model';

/**
 * Routing around a jam. The visibility-graph fields used to be priced on
 * clear ground only, so every pedestrian walked the geometrically shortest
 * route into whatever crowd was already stuck on it. With the periodic
 * recost, a jammed stretch reads as a longer one, and the field hands the
 * approaching a detour while the queued drain where they stand.
 */

const R = 13;

/**
 * A barrier with two gaps: a short channel straight toward the goal, and a
 * long detour further up. The short gap is mostly plugged with goal-less
 * standing pedestrians -- bodies the driver never moves -- so it passes only
 * a trickle, and the detour is where the throughput is.
 */
function world() {
  const barrierTop = makeWall([rectanglePolygon([0, -420], [40, -50])]);
  const barrierMid = makeWall([rectanglePolygon([0, 50], [40, 210])]);
  const barrierBot = makeWall([rectanglePolygon([0, 310], [40, 420])]);
  const roof = makeWall([rectanglePolygon([-700, -460], [700, -420])]);
  const floor = makeWall([rectanglePolygon([-700, 420], [700, 460])]);
  const goal = makeWall([rectanglePolygon([500, -50], [580, 50])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([barrierTop, barrierMid, barrierBot, roof, floor, goal], R);
  return { nav, goal };
}

function run(recost: boolean, ticks: number): { arrived: number; positions: number[] } {
  const { nav, goal } = world();
  const agents = new Agents();
  const hash = new SpatialHash();

  for (let cx = -1; cx <= 1; cx++) {
    for (let yy = -49; yy <= 49; yy += 2 * R) {
      agents.add([20 + cx * 2 * R, yy]);
    }
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const k = agents.add([-500 + i * 30, -80 + j * 30]);
      agents.setGoal(k, goal.id, goal.color);
    }
  }

  for (let t = 1; t <= ticks; t++) {
    agents.step(nav, hash, 1.26, R, 40);
    if (recost && t % RECOST_TICKS === 0) nav.recost(hash, agents.x, agents.y, agents.count);
  }
  let arrived = 0;
  const positions: number[] = [];
  for (let i = 0; i < agents.count; i++) {
    if (agents.arrived[i]) arrived++;
    positions.push(agents.x[i], agents.y[i]);
  }
  return { arrived, positions };
}

describe('routing around a jam', () => {
  it('delivers more of the crowd when the field can see the crowd', () => {
    // Measured: 44 of 48 with the recost against 30 without, in a minute of
    // simulated time -- the trickle through the plugged gap is all the
    // congestion-blind field ever manages.
    const blind = run(false, 3600);
    const aware = run(true, 3600);
    expect(aware.arrived).toBeGreaterThan(blind.arrived + 8);
  });

  it('re-routes identically on a replay', () => {
    // The recost reads positions and a tick counter, nothing else, so runs
    // stay the same run -- routing included.
    const a = run(true, 900);
    const b = run(true, 900);
    expect(a.positions).toEqual(b.positions);
  });

  it('prices an empty map exactly as it was priced before anybody walked on it', () => {
    const { nav, goal } = world();
    const empty = new Agents();
    const hash = new SpatialHash();
    hash.build(empty.x, empty.y, 0, 65);

    const before = nav.nextWaypoint([-500, 0], goal.id);
    for (let k = 0; k < 5; k++) nav.recost(hash, empty.x, empty.y, 0);
    const after = nav.nextWaypoint([-500, 0], goal.id);
    expect(after).toEqual(before);
  });
});
