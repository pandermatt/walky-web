/**
 * Measures simulation cost per tick against agent count.
 *
 * Run with:  npx vite-node bench/simulation.ts
 *
 * This measures the simulation only -- the part that will move into a Web Worker.
 * Rendering is measured separately in the browser, since deck.gl needs a GL
 * context. See README for the combined figure.
 */
import { Navigation } from '../src/sim/navigation.ts';
import { Agents } from '../src/sim/agents.ts';
import { SpatialHash } from '../src/sim/spatialHash.ts';
import { makeWall, rectanglePolygon } from '../src/state/model.ts';
import { pxPerTickFromMps } from '../src/sim/units.ts';

const RADIUS = 13;
const PERSONAL_SPACE = 40; // the shipped default
// The shipped default walking speed, through the same conversion App does.
// Slower than the old benchmark's 4 px/tick jog, and cheaper with it -- fewer
// substeps a tick -- so numbers are not comparable across that change.
const SPEED = pxPerTickFromMps(1.35);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function buildWorld() {
  // Two walls forming a gap, plus a goal beyond: obstacles that actually make
  // the crowd path rather than walk in a straight line.
  const top = makeWall([rectanglePolygon([0, -600], [90, -140])]);
  const bottom = makeWall([rectanglePolygon([0, 140], [90, 600])]);
  const goal = makeWall([rectanglePolygon([620, -90], [740, 90])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([top, bottom, goal], RADIUS);
  return { nav, goal };
}

function run(count: number) {
  const { nav, goal } = buildWorld();
  const agents = new Agents(count);
  const hash = new SpatialHash();

  const cols = Math.ceil(Math.sqrt(count));
  let placed = 0;
  for (let i = 0; i < cols && placed < count; i++) {
    for (let j = 0; j < cols && placed < count; j++, placed++) {
      const k = agents.add([-1600 + i * 32, -1000 + j * 32]);
      agents.setGoal(k, goal.id, goal.color);
    }
  }

  for (let w = 0; w < 20; w++) agents.step(nav, hash, SPEED, RADIUS, PERSONAL_SPACE);

  const frames: number[] = [];
  for (let f = 0; f < 120; f++) {
    const t0 = performance.now();
    agents.step(nav, hash, SPEED, RADIUS, PERSONAL_SPACE);
    frames.push(performance.now() - t0);
  }
  return { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95) };
}

const counts = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];
console.log('agents      p50 ms   p95 ms   ticks/s (p95)');
for (const n of counts) {
  const { p50, p95 } = run(n);
  console.log(
    String(n).padStart(7),
    p50.toFixed(2).padStart(9),
    p95.toFixed(2).padStart(8),
    (1000 / p95).toFixed(0).padStart(12),
  );
}
