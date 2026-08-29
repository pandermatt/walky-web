export type Point = [number, number];

/**
 * Exact orientation test. Returns > 0 if c lies left of a->b, < 0 if right,
 * 0 if collinear.
 *
 * Wall coordinates are integers, so for any realistic map this is computed
 * exactly in IEEE doubles (products stay well inside 2^53) and needs no epsilon.
 */
export function orient(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Twice the signed area. Positive means counter-clockwise in a y-up frame. */
export function signedArea2(poly: Point[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The point on segment ab closest to p. */
export function closestPointOnSegment(a: Point, b: Point, p: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [a[0], a[1]];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Distance from point p to the segment ab. Java's Line2D.ptSegDist. */
export function pointSegmentDistance(a: Point, b: Point, p: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(a, p);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return orient(a, b, p) === 0
    && Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
    && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether segments ab and cd cross, ignoring contacts that are only at a shared
 * endpoint or where one segment merely touches the other's endpoint.
 *
 * This reproduces Map.lineIntersects(): Java tests intersectsLine() and then
 * discards the four shared-endpoint cases and the two cases where an endpoint of
 * the second segment lies exactly on the first. Without those exclusions every
 * graph node -- which sits on a wall corner -- would block its own edges.
 */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  if (samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d)) return false;

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  // Touching counts as not crossing, matching the ptSegDist == 0 escapes.
  if (onSegment(a, b, c) || onSegment(a, b, d)) return false;
  if (onSegment(c, d, a) || onSegment(c, d, b)) return false;

  return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
}

/** Shortest distance between two segments; 0 when they cross. */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, b, c),
    pointSegmentDistance(a, b, d),
    pointSegmentDistance(c, d, a),
    pointSegmentDistance(c, d, b),
  );
}

export function pointInPolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1])
      && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Offsets a convex polygon outward by `amount`.
 *
 * Ports PolygonEnlarger.expandPolygon: shift each edge along its outward normal,
 * then intersect consecutive shifted edges to get the new corner. The original
 * picked the shift direction from a clockwise test and rounded to integers; here
 * the direction comes from the signed area and the result stays in floats, which
 * removes the "gibt manchmal nan zurueck" case the original left a comment about.
 *
 * Requires a convex polygon with no repeated or collinear consecutive vertices --
 * which is exactly what monotoneChainHull returns.
 */
export function expandPolygon(poly: Point[], amount: number): Point[] {
  const n = poly.length;
  if (n < 3 || amount === 0) return poly.map((p) => [p[0], p[1]] as Point);

  // Outward normal depends on winding: (dy, -dx) for CCW, negated for CW.
  const sign = signedArea2(poly) > 0 ? 1 : -1;

  // Each edge becomes a line offset outward by `amount`.
  const shifted: { p: Point; q: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = (sign * dy / len) * amount;
    const ny = (-sign * dx / len) * amount;
    shifted.push({ p: [a[0] + nx, a[1] + ny], q: [b[0] + nx, b[1] + ny] });
  }

  const out: Point[] = [];
  for (let i = 0; i < shifted.length; i++) {
    const cur = shifted[i];
    const next = shifted[(i + 1) % shifted.length];
    const hit = lineIntersection(cur.p, cur.q, next.p, next.q);
    // Parallel consecutive edges cannot happen on a strict convex hull, but if
    // they do the shared corner is already correct.
    out.push(hit ?? cur.q);
  }
  return out;
}

/** Intersection of the infinite lines through p1p2 and p3p4, or null if parallel. */
export function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (d === 0) return null;
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [
    (a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d,
    (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d,
  ];
}
