import { describe, it, expect } from 'vitest';
import { dijkstra, pathFrom, type CsrGraph } from '../sim/dijkstra';

function rngFactory(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Build a CSR graph from an undirected edge list. */
function buildCsr(n: number, edges: [number, number, number][]): CsrGraph {
  const degree = new Int32Array(n);
  for (const [a, b] of edges) { degree[a]++; degree[b]++; }
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + degree[i];
  const targets = new Int32Array(offsets[n]);
  const weights = new Float32Array(offsets[n]);
  const cursor = Int32Array.from(offsets.subarray(0, n));
  for (const [a, b, w] of edges) {
    targets[cursor[a]] = b; weights[cursor[a]++] = w;
    targets[cursor[b]] = a; weights[cursor[b]++] = w;
  }
  return { nodeCount: n, offsets, targets, weights };
}

/** Reference implementation: Bellman-Ford, multi-source. */
function bellmanFord(n: number, edges: [number, number, number][], sources: number[]): number[] {
  const dist = new Array(n).fill(Infinity);
  for (const s of sources) dist[s] = 0;
  for (let i = 0; i < n; i++) {
    let changed = false;
    for (const [a, b, w] of edges) {
      if (dist[a] + w < dist[b]) { dist[b] = dist[a] + w; changed = true; }
      if (dist[b] + w < dist[a]) { dist[a] = dist[b] + w; changed = true; }
    }
    if (!changed) break;
  }
  return dist;
}

describe('dijkstra', () => {
  it('finds the cheaper of two routes', () => {
    // 0 -> 1 -> 3 costs 2; 0 -> 2 -> 3 costs 20.
    const edges: [number, number, number][] = [[0, 1, 1], [1, 3, 1], [0, 2, 10], [2, 3, 10]];
    const { dist, prev } = dijkstra(buildCsr(4, edges), [0]);
    expect(dist[3]).toBeCloseTo(2, 6);
    expect(pathFrom({ dist, prev }, 3)).toEqual([3, 1, 0]);
  });

  it('leaves unreachable nodes at Infinity with no predecessor', () => {
    const g = buildCsr(4, [[0, 1, 1]]);
    const { dist, prev } = dijkstra(g, [0]);
    expect(dist[2]).toBe(Infinity);
    expect(dist[3]).toBe(Infinity);
    expect(prev[2]).toBe(-1);
  });

  it('seeds every source at zero for a multi-source run', () => {
    const g = buildCsr(5, [[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 4, 5]]);
    const { dist } = dijkstra(g, [0, 4]);
    expect(dist[0]).toBe(0);
    expect(dist[4]).toBe(0);
    // Node 2 is 10 from either end.
    expect(dist[2]).toBeCloseTo(10, 6);
  });

  it('ignores out-of-range sources and handles an empty source set', () => {
    const g = buildCsr(3, [[0, 1, 1], [1, 2, 1]]);
    expect(dijkstra(g, []).dist.every((d) => d === Infinity)).toBe(true);
    const { dist } = dijkstra(g, [-1, 99, 0]);
    expect(dist[2]).toBeCloseTo(2, 6);
  });

  it('agrees with Bellman-Ford on random graphs', () => {
    const rand = rngFactory(20260829);
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(rand() * 30);
      const edges: [number, number, number][] = [];
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          if (rand() < 0.25) edges.push([a, b, 1 + rand() * 50]);
        }
      }
      const sources = [Math.floor(rand() * n)];
      if (rand() < 0.4) sources.push(Math.floor(rand() * n));

      const mine = dijkstra(buildCsr(n, edges), sources).dist;
      const reference = bellmanFord(n, edges, sources);
      for (let i = 0; i < n; i++) {
        if (reference[i] === Infinity) expect(mine[i]).toBe(Infinity);
        // Float32 storage, so compare with a tolerance proportional to magnitude.
        else expect(Math.abs(mine[i] - reference[i])).toBeLessThan(1e-3 * (1 + reference[i]));
      }
    }
  });

  it('handles a large chain without stack or heap trouble', () => {
    const n = 20000;
    const edges: [number, number, number][] = [];
    for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1, 1]);
    const { dist } = dijkstra(buildCsr(n, edges), [0]);
    expect(dist[n - 1]).toBeCloseTo(n - 1, 0);
  });
});
