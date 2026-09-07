import { pointSegmentDistance, type Point } from './geometry';

/**
 * Ramer-Douglas-Peucker polyline simplification.
 *
 * A freehand stroke arrives as one point per pointer event -- hundreds for a
 * single shape, most a pixel apart and carrying no information. Every one would
 * become a polygon vertex, and vertex count is what the navigation pipeline costs
 * scale on: the convex hull, the decomposition into convex parts, and above all
 * the O(n^2) visibility sweep over the corners those parts produce.
 *
 * RDP keeps the points that carry the shape -- the corners -- and discards those
 * merely sitting along a line, guaranteeing no discarded point was further than
 * `tolerance` from the kept outline.
 */
export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((p) => [p[0], p[1]] as Point);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Explicit stack rather than recursion: a long stroke can be thousands of
  // points, and the worst case recurses once per point.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointSegmentDistance(points[first], points[last], points[i]);
      if (d > worst) { worst = d; worstIndex = i; }
    }
    if (worstIndex >= 0 && worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i][0], points[i][1]]);
  return out;
}

/**
 * Simplifies a closed outline.
 *
 * A ring has no natural endpoints for RDP to anchor on, and anchoring at an
 * arbitrary index pins two neighbours that may sit mid-edge. Anchoring at the two
 * points furthest apart instead splits the ring into halves that each simplify
 * cleanly.
 */
export function simplifyClosed(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points.map((p) => [p[0], p[1]] as Point);

  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
    if (d > best) { best = d; b = i; }
  }
  best = -1;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i][0] - points[b][0]) ** 2 + (points[i][1] - points[b][1]) ** 2;
    if (d > best) { best = d; a = i; }
  }
  if (a === b) return points.map((p) => [p[0], p[1]] as Point);

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const front = simplifyPolyline(points.slice(lo, hi + 1), tolerance);
  const back = simplifyPolyline([...points.slice(hi), ...points.slice(0, lo + 1)], tolerance);
  // Both halves include the two anchors; drop the duplicates when rejoining.
  return [...front, ...back.slice(1, -1)];
}
