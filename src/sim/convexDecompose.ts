import { monotoneChainHull } from './convexHull';
import { orient, signedArea2, type Point } from './geometry';

/**
 * Splits a simple polygon into convex parts.
 *
 * Needed because one convex hull per wall fills in any concavity. A U-shaped wall
 * hulls to a solid rectangle, so its cavity becomes unreachable -- a goal placed
 * inside can never be routed to, because every one of its graph nodes is dropped
 * for sitting inside the U's hull. Decomposing first keeps the navigation built
 * from convex hulls, while leaving real cavities open.
 *
 * Ear-clip to triangles, then merge neighbours back together while the union
 * stays convex (Hertel-Mehlhorn). The merge test is neat: two edge-sharing pieces
 * form a convex union exactly when the hull of their combined vertices has the
 * same area as the two pieces put together.
 */

function area2(poly: Point[]): number {
  return Math.abs(signedArea2(poly));
}

export function isConvex(poly: Point[]): boolean {
  const n = poly.length;
  if (n < 4) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const o = orient(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]);
    if (o === 0) continue;
    const s = o > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = orient(a, b, p);
  const d2 = orient(b, c, p);
  const d3 = orient(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Ear clipping. Expects a counter-clockwise, duplicate-free ring. */
function earClip(poly: Point[]): Point[][] {
  const idx = poly.map((_, i) => i);
  const out: Point[][] = [];
  let guard = 0;

  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const prev = poly[idx[(k - 1 + idx.length) % idx.length]];
      const cur = poly[idx[k]];
      const next = poly[idx[(k + 1) % idx.length]];

      // A convex corner in a CCW ring turns left.
      if (orient(prev, cur, next) <= 0) continue;

      // No other vertex may sit inside the candidate ear.
      let clean = true;
      for (let m = 0; m < idx.length && clean; m++) {
        if (m === k || m === (k - 1 + idx.length) % idx.length || m === (k + 1) % idx.length) continue;
        if (pointInTriangle(poly[idx[m]], prev, cur, next)) clean = false;
      }
      if (!clean) continue;

      out.push([prev, cur, next]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    // Self-intersecting or otherwise degenerate: stop rather than spin.
    if (!clipped) break;
  }

  if (idx.length >= 3) out.push(idx.map((i) => poly[i]));
  return out.filter((t) => area2(t) > 1e-9);
}

function sharesEdge(a: Point[], b: Point[]): boolean {
  let shared = 0;
  for (const p of a) {
    for (const q of b) {
      if (p[0] === q[0] && p[1] === q[1]) { shared++; break; }
    }
  }
  return shared >= 2;
}

export function convexDecompose(polygon: Point[]): Point[][] {
  // Drop consecutive duplicates.
  const ring: Point[] = [];
  for (const p of polygon) {
    const last = ring[ring.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push([p[0], p[1]]);
  }
  while (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    else break;
  }
  if (ring.length < 3) return [];
  if (isConvex(ring)) return [ring];

  // Ear clipping expects counter-clockwise.
  const ccw = signedArea2(ring) > 0 ? ring : [...ring].reverse();
  let pieces = earClip(ccw);
  if (pieces.length === 0) return [ccw];

  // Merge neighbours while the union stays convex.
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 1000) {
    merged = false;
    outer:
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (!sharesEdge(pieces[i], pieces[j])) continue;
        const hull = monotoneChainHull([...pieces[i], ...pieces[j]]);
        if (hull.length < 3) continue;
        const combined = area2(pieces[i]) + area2(pieces[j]);
        // Equal areas means the hull adds nothing: the union is already convex.
        if (Math.abs(area2(hull) - combined) > 1e-6 * Math.max(1, combined)) continue;
        pieces = pieces.filter((_, k) => k !== i && k !== j).concat([hull]);
        merged = true;
        break outer;
      }
    }
  }
  return pieces;
}
