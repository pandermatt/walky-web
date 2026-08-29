import { describe, it, expect } from 'vitest';
import { SpatialHash } from '../sim/spatialHash';

function rngFactory(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Reference: the O(n^2) scan the original did in Map.getColosionPedestrian. */
function bruteForce(x: Float32Array, y: Float32Array, n: number, i: number, r: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    if (Math.hypot(x[j] - x[i], y[j] - y[i]) <= r) out.push(j);
  }
  return out.sort((a, b) => a - b);
}

describe('SpatialHash', () => {
  it('agrees with a brute-force scan on random layouts', () => {
    const rand = rngFactory(777);
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rand() * 400);
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) { x[i] = rand() * 1000 - 500; y[i] = rand() * 1000 - 500; }

      const radius = 10 + rand() * 90;
      const hash = new SpatialHash();
      hash.build(x, y, n, 2 * radius);

      for (let i = 0; i < Math.min(n, 25); i++) {
        const got = [...hash.query(x[i], y[i], radius, i, x, y)].sort((a, b) => a - b);
        expect(got).toEqual(bruteForce(x, y, n, i, radius));
      }
    }
  });

  it('handles an empty set and a single agent', () => {
    const hash = new SpatialHash();
    const x = new Float32Array(1);
    const y = new Float32Array(1);
    hash.build(x, y, 0, 10);
    expect(hash.query(0, 0, 50, -1, x, y)).toHaveLength(0);
    hash.build(x, y, 1, 10);
    expect(hash.query(0, 0, 50, 0, x, y)).toHaveLength(0);
  });

  it('copes with every agent stacked on one point', () => {
    const n = 200;
    const x = new Float32Array(n).fill(42);
    const y = new Float32Array(n).fill(-7);
    const hash = new SpatialHash();
    hash.build(x, y, n, 20);
    expect(hash.query(42, -7, 1, 0, x, y)).toHaveLength(n - 1);
  });

  it('grows its scratch buffer past the initial capacity', () => {
    const n = 500;
    const x = new Float32Array(n).fill(0);
    const y = new Float32Array(n).fill(0);
    const hash = new SpatialHash();
    hash.build(x, y, n, 20);
    expect(hash.query(0, 0, 5, 0, x, y)).toHaveLength(n - 1);
  });
});
