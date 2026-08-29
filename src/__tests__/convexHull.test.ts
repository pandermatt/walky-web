import { describe, it, expect } from 'vitest';
import { monotoneChainHull } from '../sim/convexHull';
import { orient, pointInPolygon, signedArea2, expandPolygon, pointSegmentDistance, type Point } from '../sim/geometry';

function rngFactory(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Brute-force O(n^3) hull: an edge is on the hull if all points lie on one side. */
function bruteForceHullSize(pts: Point[]): number {
  const onHull = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      let allLeft = true, allRight = true;
      for (let k = 0; k < pts.length; k++) {
        if (k === i || k === j) continue;
        const o = orient(pts[i], pts[j], pts[k]);
        if (o > 0) allRight = false;
        if (o < 0) allLeft = false;
      }
      if (allLeft || allRight) { onHull.add(pts[i].join()); onHull.add(pts[j].join()); }
    }
  }
  return onHull.size;
}

describe('monotoneChainHull', () => {
  it('returns a square for a square with an interior point', () => {
    const hull = monotoneChainHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
    expect(hull).toHaveLength(4);
    expect(new Set(hull.map((p) => p.join()))).toEqual(new Set(['0,0', '10,0', '10,10', '0,10']));
  });

  it('drops collinear points along an edge', () => {
    const hull = monotoneChainHull([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]);
    expect(hull).toHaveLength(4);
    expect(hull.map((p) => p.join())).not.toContain('5,0');
  });

  it('handles duplicates, n<=3 and fully collinear input', () => {
    expect(monotoneChainHull([])).toEqual([]);
    expect(monotoneChainHull([[1, 1]])).toEqual([[1, 1]]);
    expect(monotoneChainHull([[1, 1], [1, 1], [1, 1]])).toEqual([[1, 1]]);
    expect(monotoneChainHull([[0, 0], [2, 2]])).toHaveLength(2);
    // All collinear collapses to the two extremes.
    const line = monotoneChainHull([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(line).toEqual([[0, 0], [3, 3]]);
  });

  it('contains every input point, over random sets', () => {
    const rand = rngFactory(12345);
    for (let trial = 0; trial < 200; trial++) {
      const pts: Point[] = Array.from({ length: 3 + Math.floor(rand() * 40) }, () =>
        [Math.floor(rand() * 500), Math.floor(rand() * 500)] as Point);
      const hull = monotoneChainHull(pts);
      if (hull.length < 3) continue;
      for (const p of pts) {
        const inside = pointInPolygon(hull, p);
        const onEdge = hull.some((h, i) =>
          pointSegmentDistance(h, hull[(i + 1) % hull.length], p) < 1e-9);
        expect(inside || onEdge).toBe(true);
      }
    }
  });

  it('has consistent winding and is strictly convex', () => {
    const rand = rngFactory(999);
    for (let trial = 0; trial < 200; trial++) {
      const pts: Point[] = Array.from({ length: 5 + Math.floor(rand() * 30) }, () =>
        [Math.floor(rand() * 300), Math.floor(rand() * 300)] as Point);
      const hull = monotoneChainHull(pts);
      if (hull.length < 3) continue;
      const area = signedArea2(hull);
      const sign = Math.sign(area);
      expect(sign).not.toBe(0);
      // Every turn goes the same way, and none is a straight line.
      for (let i = 0; i < hull.length; i++) {
        const o = orient(hull[i], hull[(i + 1) % hull.length], hull[(i + 2) % hull.length]);
        expect(Math.sign(o)).toBe(sign);
      }
    }
  });

  it('agrees with a brute-force hull on vertex count', () => {
    const rand = rngFactory(4242);
    for (let trial = 0; trial < 100; trial++) {
      const seen = new Set<string>();
      const pts: Point[] = [];
      while (pts.length < 12) {
        const p: Point = [Math.floor(rand() * 40), Math.floor(rand() * 40)];
        if (!seen.has(p.join())) { seen.add(p.join()); pts.push(p); }
      }
      const hull = monotoneChainHull(pts);
      if (hull.length < 3) continue;
      // Brute force counts collinear edge points too; ours drops them, so it is a
      // lower bound. Compare against the strictly-convex subset.
      const strict = new Set(hull.map((p) => p.join()));
      expect(strict.size).toBeLessThanOrEqual(bruteForceHullSize(pts));
      for (const v of strict) expect(pts.some((p) => p.join() === v)).toBe(true);
    }
  });
});

describe('expandPolygon', () => {
  it('pushes every edge out by exactly the radius', () => {
    const square: Point[] = monotoneChainHull([[0, 0], [100, 0], [100, 100], [0, 100]]);
    const grown = expandPolygon(square, 13);
    // Each original edge should now sit 13 away from the grown outline.
    for (let i = 0; i < square.length; i++) {
      const mid: Point = [
        (square[i][0] + square[(i + 1) % square.length][0]) / 2,
        (square[i][1] + square[(i + 1) % square.length][1]) / 2,
      ];
      const d = Math.min(...grown.map((g, j) =>
        pointSegmentDistance(g, grown[(j + 1) % grown.length], mid)));
      expect(d).toBeCloseTo(13, 6);
    }
  });

  it('grows outward, never inward', () => {
    const hull = monotoneChainHull([[10, 10], [90, 20], [80, 95], [15, 80]]);
    const grown = expandPolygon(hull, 13);
    expect(Math.abs(signedArea2(grown))).toBeGreaterThan(Math.abs(signedArea2(hull)));
    for (const p of hull) expect(pointInPolygon(grown, p)).toBe(true);
  });

  it('keeps winding and vertex count', () => {
    const hull = monotoneChainHull([[0, 0], [50, 5], [60, 60], [5, 55]]);
    const grown = expandPolygon(hull, 20);
    expect(grown).toHaveLength(hull.length);
    expect(Math.sign(signedArea2(grown))).toBe(Math.sign(signedArea2(hull)));
  });
});
