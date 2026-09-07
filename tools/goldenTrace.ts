/**
 * Writes the golden fixtures the Swift port is checked against.
 *
 *   npx vite-node tools/goldenTrace.ts
 *
 * Two kinds. `graph-*.wkgr` is geometry only -- nodes, the CSR adjacency, and a
 * routing field per goal -- and nothing steps. The rest are `.wktr` runs: one
 * record per agent per tick, recorded straight off the typed arrays.
 *
 * Each fixture is paired with a `.json` manifest describing the world it was
 * recorded from, so the Swift side *builds* from data rather than from a
 * transcription of tools/traceScenarios.ts. Hand-copying a scenario into Swift
 * is where two ports come to disagree about the input while arguing about the
 * output, and that argument is unwinnable because both sides look right.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildVisibilityGraph, nodesOfWall } from '../src/sim/visibilityGraph.ts';
import { dijkstra } from '../src/sim/dijkstra.ts';
import { fnv1a64, encodeTrace } from './traceFormat.ts';
import { SCENARIOS, buildScenario, R } from './traceScenarios.ts';
import { GRAPH_SCENARIOS } from './graphScenarios.ts';
import type { Wall } from '../src/state/model.ts';

const OUT = resolve(import.meta.dirname, '../ios/Fixtures');
const GRAPH_MAGIC = 0x5247_4b57; // "WKGR"
const GRAPH_VERSION = 1;

mkdirSync(OUT, { recursive: true });

/** The world, as the Swift side will rebuild it. Ids are resolved, not assumed. */
function wallManifest(walls: Wall[]) {
  return walls.map((w, index) => ({
    index,
    polygons: w.polygons,
    color: w.color,
    isGoal: w.isGoal,
    isBorder: w.isBorder,
  }));
}

function writeGraph(name: string, proves: string, walls: Wall[]) {
  const graph = buildVisibilityGraph(walls, R);
  // Wall ids come from a run-local counter, so everything written below refers
  // to walls by their index in this scenario instead. See traceFormat.ts.
  const wallIds = walls.map((w) => w.id);
  const indexOfWall = (id: number) => wallIds.indexOf(id);
  const n = graph.nodes.length;
  const csr = graph.csr;
  const edges = csr.targets.length;
  const goals = walls.filter((w) => w.isGoal);

  const nameBytes = new TextEncoder().encode(name);
  const size =
    4 + 4 + 2 + nameBytes.length +
    4 + n * 16 +                       // nodes, as the doubles they are
    n * 4 * 4 +                        // nodeWall, nodePart, nodeRingIndex, ringLength
    4 + (n + 1) * 4 + edges * 4 + edges * 4 +
    4 + goals.length * (4 + n * 4 + n * 4) +
    8;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  view.setUint32(o, GRAPH_MAGIC, true); o += 4;
  view.setUint32(o, GRAPH_VERSION, true); o += 4;
  view.setUint16(o, nameBytes.length, true); o += 2;
  bytes.set(nameBytes, o); o += nameBytes.length;

  const start = o;
  view.setUint32(o, n, true); o += 4;
  // Node positions stay float64: they come out of expandPolygon, which is the
  // most numerically delicate thing in sim/, and rounding them here would hide
  // exactly the disagreement worth catching.
  for (const [x, y] of graph.nodes) { view.setFloat64(o, x, true); view.setFloat64(o + 8, y, true); o += 16; }
  for (let i = 0; i < n; i++) { view.setInt32(o, indexOfWall(graph.nodeWall[i]), true); o += 4; }
  for (let i = 0; i < n; i++) { view.setInt32(o, graph.nodePart[i], true); o += 4; }
  for (let i = 0; i < n; i++) { view.setInt32(o, graph.nodeRingIndex[i], true); o += 4; }
  for (let i = 0; i < n; i++) { view.setInt32(o, graph.ringLength[i], true); o += 4; }
  view.setUint32(o, edges, true); o += 4;
  for (let i = 0; i <= n; i++) { view.setInt32(o, csr.offsets[i], true); o += 4; }
  for (let i = 0; i < edges; i++) { view.setInt32(o, csr.targets[i], true); o += 4; }
  for (let i = 0; i < edges; i++) { view.setFloat32(o, csr.weights[i], true); o += 4; }

  view.setUint32(o, goals.length, true); o += 4;
  for (const g of goals) {
    // Built the way navigation.ts:89-93 builds them, and in the same order --
    // which is the order that decides the recost round-robin.
    const field = dijkstra(csr, nodesOfWall(graph, g.id));
    view.setInt32(o, indexOfWall(g.id), true); o += 4;
    for (let i = 0; i < n; i++) { view.setFloat32(o, field.dist[i], true); o += 4; }
    for (let i = 0; i < n; i++) { view.setInt32(o, field.prev[i], true); o += 4; }
  }

  view.setBigUint64(o, fnv1a64(bytes.subarray(start, o)), true); o += 8;

  writeFileSync(resolve(OUT, `${name}.wkgr`), bytes.subarray(0, o));
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify({
    kind: 'graph', name, proves, radius: R, walls: wallManifest(walls),
  }, null, 2));
  return { nodes: n, edges, goals: goals.length, bytes: o };
}

function writeTrace(specIndex: number, full = false) {
  const spec = SCENARIOS[specIndex];
  const { walls, agents, step } = buildScenario(spec);

  const wallIds = walls.map((w) => w.id);
  // The manifest records placements by wall *index* for the same reason the
  // trace does: an id is a property of the run, not of the map.
  const placements: { x: number; y: number; goal: number }[] = [];
  for (let i = 0; i < agents.count; i++) {
    placements.push({ x: agents.x[i], y: agents.y[i], goal: wallIds.indexOf(agents.goal[i]) });
  }

  const bytes = encodeTrace(
    spec.name, R, spec.speed, spec.personalSpace, spec.ticks, agents, wallIds, step,
    { full },
  );

  // A --full trace is a debugging artefact, not a fixture: it is git-ignored
  // and named apart so it can never be mistaken for the committed one.
  writeFileSync(resolve(OUT, full ? `${spec.name}.full.wktr` : `${spec.name}.wktr`), bytes);
  if (full) return { agents: agents.count, arrived: 0, bytes: bytes.length };
  writeFileSync(resolve(OUT, `${spec.name}.json`), JSON.stringify({
    kind: 'trace',
    name: spec.name,
    proves: spec.proves,
    radius: R,
    speed: spec.speed,
    personalSpace: spec.personalSpace,
    ticks: spec.ticks,
    walls: wallManifest(walls),
    agents: placements,
  }, null, 2));

  let arrived = 0;
  for (let i = 0; i < agents.count; i++) if (agents.arrived[i]) arrived++;
  return { agents: agents.count, arrived, bytes: bytes.length };
}

const argv = process.argv.slice(2);
const fullIndex = argv.indexOf('--full');
if (fullIndex >= 0) {
  const want = argv[fullIndex + 1];
  const i = SCENARIOS.findIndex((s) => s.name === want);
  if (i < 0) {
    console.error(`no scenario named ${want}. one of: ${SCENARIOS.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
  const r = writeTrace(i, true);
  console.log(`${SCENARIOS[i].name}.full.wktr — every tick, ${(r.bytes / 1024 / 1024).toFixed(1)} MB, git-ignored`);
  process.exit(0);
}

console.log(`writing to ${OUT}\n`);
console.log('graph fixtures — geometry only, nothing steps');
for (const g of GRAPH_SCENARIOS) {
  const r = writeGraph(g.name, g.proves, g.build());
  console.log(`  ${g.name.padEnd(16)} ${String(r.nodes).padStart(4)} nodes  ${String(r.edges).padStart(6)} edges  ${r.goals} goal(s)  ${(r.bytes / 1024).toFixed(0)} KB`);
}

console.log('\ntrace fixtures — one record per agent per tick');
for (let i = 0; i < SCENARIOS.length; i++) {
  const s = SCENARIOS[i];
  const r = writeTrace(i);
  console.log(`  ${s.name.padEnd(16)} ${String(r.agents).padStart(4)} agents  ${String(s.ticks).padStart(4)} ticks  ${String(r.arrived).padStart(4)} arrived  ${(r.bytes / 1024).toFixed(0)} KB`);
}
console.log('');
