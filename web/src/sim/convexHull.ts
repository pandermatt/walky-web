import { orient, type Point } from './geometry';

/**
 * Andrew's monotone chain convex hull, O(n log n).
 *
 * Replaces the original's ConvexHullGenerator.createQuickHull (adapted from a 2007
 * web posting), which is O(n^2) in the worst case and mishandles collinear input.
 * Monotone chain sorts once and builds two chains with an exact integer orientation
 * test, so collinear runs, duplicate points and degenerate inputs are all decided
 * without an epsilon.
 *
 * Returns a strictly convex hull: collinear points along an edge are dropped, which
 * is what makes the offset step in expandPolygon well defined.
 */
export function monotoneChainHull(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];

  // Sort by x, then y, and drop exact duplicates.
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const uniq: Point[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p);
  }
  const n = uniq.length;
  if (n < 3) return uniq.map((p) => [p[0], p[1]] as Point);

  const build = (src: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of src) {
      // <= 0 drops collinear points, giving a strictly convex hull.
      while (chain.length >= 2 && orient(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop(); // last point belongs to the other chain
    return chain;
  };

  const lower = build(uniq);
  const upper = build([...uniq].reverse());
  const hull = lower.concat(upper);

  // All input collinear: both chains collapse to the two extreme points.
  if (hull.length < 3) {
    return [uniq[0], uniq[n - 1]].map((p) => [p[0], p[1]] as Point);
  }
  return hull.map((p) => [p[0], p[1]] as Point);
}
