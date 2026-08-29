import { describe, it, expect } from 'vitest';
import { simplifyPolyline, simplifyClosed } from '../sim/simplify';
import { pointSegmentDistance, type Point } from '../sim/geometry';

describe('simplifyPolyline', () => {
  it('collapses a dense straight run to its endpoints', () => {
    const line: Point[] = Array.from({ length: 200 }, (_, i) => [i, 0]);
    expect(simplifyPolyline(line, 1)).toEqual([[0, 0], [199, 0]]);
  });

  it('keeps corners', () => {
    const shape: Point[] = [[0, 0], [50, 0], [100, 0], [100, 50], [100, 100]];
    expect(simplifyPolyline(shape, 1)).toEqual([[0, 0], [100, 0], [100, 100]]);
  });

  it('never drops a point further than the tolerance from the kept outline', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 40; trial++) {
      const pts: Point[] = [];
      let x = 0, y = 0;
      for (let i = 0; i < 300; i++) { x += rand() * 6 - 2; y += rand() * 6 - 3; pts.push([x, y]); }
      const tol = 2;
      const simple = simplifyPolyline(pts, tol);
      expect(simple.length).toBeLessThan(pts.length);
      for (const p of pts) {
        let nearest = Infinity;
        for (let i = 0; i + 1 < simple.length; i++) {
          nearest = Math.min(nearest, pointSegmentDistance(simple[i], simple[i + 1], p));
        }
        expect(nearest).toBeLessThanOrEqual(tol + 1e-9);
      }
    }
  });

  it('leaves short inputs and zero tolerance alone', () => {
    expect(simplifyPolyline([[0, 0]], 5)).toEqual([[0, 0]]);
    expect(simplifyPolyline([[0, 0], [9, 9]], 5)).toEqual([[0, 0], [9, 9]]);
    expect(simplifyPolyline([[0, 0], [1, 0], [2, 0]], 0)).toHaveLength(3);
  });
});

describe('simplifyClosed', () => {
  it('reduces a many-point circle while keeping its extent', () => {
    const circle: Point[] = Array.from({ length: 360 }, (_, i) => {
      const a = (i / 360) * Math.PI * 2;
      return [Math.cos(a) * 100, Math.sin(a) * 100] as Point;
    });
    const out = simplifyClosed(circle, 3);
    expect(out.length).toBeLessThan(60);
    expect(out.length).toBeGreaterThan(6);
    const xs = out.map((p) => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(90);
    expect(Math.min(...xs)).toBeLessThan(-90);
  });

  it('keeps the corners of a traced rectangle', () => {
    const ring: Point[] = [];
    for (let x = 0; x <= 100; x += 2) ring.push([x, 0]);
    for (let y = 2; y <= 60; y += 2) ring.push([100, y]);
    for (let x = 98; x >= 0; x -= 2) ring.push([x, 60]);
    for (let y = 58; y >= 2; y -= 2) ring.push([0, y]);
    const out = simplifyClosed(ring, 1.5);
    expect(out.length).toBeLessThanOrEqual(6);
    for (const corner of [[0, 0], [100, 0], [100, 60], [0, 60]]) {
      expect(out.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 3)).toBe(true);
    }
  });

  it('passes tiny rings through untouched', () => {
    const tri: Point[] = [[0, 0], [10, 0], [5, 9]];
    expect(simplifyClosed(tri, 2)).toEqual(tri);
  });
});
