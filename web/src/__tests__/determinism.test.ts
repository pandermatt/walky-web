import { describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { Navigation } from '../sim/navigation';
import { makeWall, rectanglePolygon } from '../state/model';
import type { RGB } from '../palette';

/**
 * The model's oldest promise, held to the letter: a run is the same run every
 * time. Everything that looks random -- the fidget, the carry wander, the
 * wall-escape jiggle, a door's bursts -- is a hash of where somebody stands and
 * how long they have stood there, so building the same map twice and stepping it
 * the same number of times must land every single pedestrian on the same pixel.
 *
 * The scenarios are chosen to reach the draws an ordinary walk never does:
 * a deep crush (carryStep's wander), a pedestrian buried in a wall (escapeStep's
 * tie-breaks) and one sealed in a room (randomStep). If any of those ever picks
 * up a genuine random number again, these fail on the spot.
 */

const R = 13;

function positions(a: Agents): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.count; i++) out.push(a.x[i], a.y[i]);
  return out;
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

/** The bottleneck crush from crowd.test.ts, which provably carries people. */
function runCrush(ticks: number) {
  const top = makeWall([rectanglePolygon([0, -500], [40, -35])]);
  const bottom = makeWall([rectanglePolygon([0, 35], [40, 500])]);
  const goal = makeWall([rectanglePolygon([260, -40], [340, 40])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([top, bottom, goal], R);
  const agents = new Agents();
  const hash = new SpatialHash();
  block(agents, goal.id, goal.color, 14, 12, -560, -209, 38);

  let shoved = 0;
  for (let t = 0; t < ticks; t++) {
    agents.step(nav, hash, 4, R, 60);
    shoved += agents.carries;
  }
  return { agents, shoved };
}

/** A pedestrian buried in a wall, and one sealed in a room with the goal outside. */
function runStuck(ticks: number) {
  const slab = makeWall([rectanglePolygon([-100, -100], [100, 100])]);
  const box = makeWall([
    rectanglePolygon([300, -100], [500, -80]),
    rectanglePolygon([300, 80], [500, 100]),
    rectanglePolygon([300, -100], [320, 100]),
    rectanglePolygon([480, -100], [500, 100]),
  ]);
  const goal = makeWall([rectanglePolygon([700, -40], [780, 40])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([slab, box, goal], R);

  const agents = new Agents();
  const hash = new SpatialHash();
  const buried = agents.add([0, 0]);
  agents.setGoal(buried, goal.id, goal.color);
  const sealed = agents.add([400, 0]);
  agents.setGoal(sealed, goal.id, goal.color);

  for (let t = 0; t < ticks; t++) agents.step(nav, hash, 4, R, 40);
  return { agents, buried, sealed };
}

describe('the same run every time', () => {
  it('replays a crush tick for tick', () => {
    const a = runCrush(400);
    const b = runCrush(400);
    // The scenario must actually reach the carry wander, or this proves nothing.
    expect(a.shoved).toBeGreaterThan(0);
    expect(positions(a.agents)).toEqual(positions(b.agents));
  });

  it('replays the jiggles of the stuck tick for tick', () => {
    const a = runStuck(300);
    const b = runStuck(300);
    // The buried one must have worked itself loose -- proof escapeStep ran.
    expect(Math.hypot(a.agents.x[a.buried], a.agents.y[a.buried])).toBeGreaterThan(1);
    // The sealed one must have fidgeted -- proof the no-route path ran.
    expect(a.agents.x[a.sealed] !== 400 || a.agents.y[a.sealed] !== 0).toBe(true);
    expect(positions(a.agents)).toEqual(positions(b.agents));
  });
});
