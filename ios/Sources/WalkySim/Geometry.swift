import Foundation

/// Ports `src/sim/geometry.ts`.
///
/// Every `Math.hypot` here is `jsHypot`, every `Math.min`/`Math.max` is
/// `jsMin`/`jsMax`, and every value is a `Double` -- JS has no other number.
/// Those are not stylistic choices: see JSMath.swift for what each one costs
/// when it is got wrong.
public struct Point: Equatable, Sendable, CustomStringConvertible {
  public var x: Double
  public var y: Double
  @inline(__always) public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
  public var description: String { "(\(x), \(y))" }
}

/// Exact orientation test: > 0 if c lies left of a->b, < 0 if right, 0 if collinear.
///
/// Wall coordinates are integers, so for any realistic map this is exact in
/// IEEE doubles -- products stay well inside 2^53 -- and needs no epsilon.
@inline(__always)
public func orient(_ a: Point, _ b: Point, _ c: Point) -> Double {
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/// Twice the signed area. Positive means counter-clockwise in a y-up frame.
public func signedArea2(_ poly: [Point]) -> Double {
  var s = 0.0
  let n = poly.count
  for i in 0..<n {
    let p1 = poly[i]
    let p2 = poly[(i + 1) % n]
    s += p1.x * p2.y - p2.x * p1.y
  }
  return s
}

public func distance(_ a: Point, _ b: Point) -> Double {
  jsHypot(b.x - a.x, b.y - a.y)
}

/// The point on segment ab closest to p.
public func closestPointOnSegment(_ a: Point, _ b: Point, _ p: Point) -> Point {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let lenSq = dx * dx + dy * dy
  if lenSq == 0 { return Point(a.x, a.y) }
  var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = t < 0 ? 0 : (t > 1 ? 1 : t)
  return Point(a.x + t * dx, a.y + t * dy)
}

/// Distance from point p to the segment ab. Java's `Line2D.ptSegDist`.
public func pointSegmentDistance(_ a: Point, _ b: Point, _ p: Point) -> Double {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let lenSq = dx * dx + dy * dy
  if lenSq == 0 { return distance(a, p) }
  var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = t < 0 ? 0 : (t > 1 ? 1 : t)
  return jsHypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

@inline(__always)
private func onSegment(_ a: Point, _ b: Point, _ p: Point) -> Bool {
  orient(a, b, p) == 0
    && jsMin(a.x, b.x) <= p.x && p.x <= jsMax(a.x, b.x)
    && jsMin(a.y, b.y) <= p.y && p.y <= jsMax(a.y, b.y)
}

/// Whether segments ab and cd cross, ignoring contacts at a shared endpoint or
/// where one segment merely touches the other's endpoint.
///
/// Reproduces `Map.lineIntersects()`. Without those exclusions every graph
/// node -- which sits on a wall corner -- would block its own edges.
public func segmentsCross(_ a: Point, _ b: Point, _ c: Point, _ d: Point) -> Bool {
  if a == c || a == d || b == c || b == d { return false }

  let o1 = orient(a, b, c)
  let o2 = orient(a, b, d)
  let o3 = orient(c, d, a)
  let o4 = orient(c, d, b)

  // Touching counts as not crossing, matching the ptSegDist == 0 escapes.
  if onSegment(a, b, c) || onSegment(a, b, d) { return false }
  if onSegment(c, d, a) || onSegment(c, d, b) { return false }

  return ((o1 > 0) != (o2 > 0)) && ((o3 > 0) != (o4 > 0))
}

/// Shortest distance between two segments; 0 when they cross.
public func segmentDistance(_ a: Point, _ b: Point, _ c: Point, _ d: Point) -> Double {
  if segmentsCross(a, b, c, d) { return 0 }
  return jsMin(
    jsMin(pointSegmentDistance(a, b, c), pointSegmentDistance(a, b, d)),
    jsMin(pointSegmentDistance(c, d, a), pointSegmentDistance(c, d, b)))
}

public func pointInPolygon(_ poly: [Point], _ p: Point) -> Bool {
  var inside = false
  var j = poly.count - 1
  for i in 0..<poly.count {
    let pi = poly[i], pj = poly[j]
    if (pi.y > p.y) != (pj.y > p.y)
      && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x {
      inside = !inside
    }
    j = i
  }
  return inside
}

/// How far a corner may reach past its vertex, as a multiple of the offset.
///
/// A pure miter reaches `amount / sin(theta / 2)`, unbounded as the corner
/// sharpens: a 1.8-degree needle offset by a radius of 13 puts the corner over
/// 800 units away. Those spikes are not merely ugly -- the same hulls are what
/// `isVisible` treats as solid, so each is a phantom wall blocking open ground.
public let MITER_LIMIT: Double = 2

/// Offsets a convex polygon outward by `amount`.
///
/// Ports `PolygonEnlarger.expandPolygon`: shift each edge along its outward
/// normal, then intersect consecutive shifted edges. Corners past `miterLimit`
/// are cut off, so the result is usually but not always one vertex per input
/// edge -- a cut corner contributes two.
///
/// Requires a convex polygon with no repeated or collinear consecutive
/// vertices, which is exactly what `monotoneChainHull` returns.
public func expandPolygon(_ poly: [Point], _ amount: Double,
                          _ miterLimit: Double = MITER_LIMIT) -> [Point] {
  let n = poly.count
  if n < 3 || amount == 0 { return poly.map { Point($0.x, $0.y) } }

  // Outward normal depends on winding: (dy, -dx) for CCW, negated for CW.
  let sign: Double = signedArea2(poly) > 0 ? 1 : -1

  struct Shifted { var p: Point; var q: Point; var v: Point }
  var shifted: [Shifted] = []
  shifted.reserveCapacity(n)
  for i in 0..<n {
    let a = poly[i]
    let b = poly[(i + 1) % n]
    let dx = b.x - a.x
    let dy = b.y - a.y
    let len = jsHypot(dx, dy)
    if len == 0 { continue }
    let nx = (sign * dy / len) * amount
    let ny = (-sign * dx / len) * amount
    shifted.append(Shifted(p: Point(a.x + nx, a.y + ny), q: Point(b.x + nx, b.y + ny), v: b))
  }

  let maxReach = abs(miterLimit * amount)
  var out: [Point] = []
  out.reserveCapacity(shifted.count + 4)
  for i in 0..<shifted.count {
    let cur = shifted[i]
    let next = shifted[(i + 1) % shifted.count]
    // Parallel consecutive edges cannot happen on a strict convex hull, but if
    // they do the shared corner is already correct.
    guard let hit = lineIntersection(cur.p, cur.q, next.p, next.q) else {
      out.append(cur.q); continue
    }

    let v = cur.v
    let reach = jsHypot(hit.x - v.x, hit.y - v.y)
    if reach <= maxReach { out.append(hit); continue }

    // Cut perpendicular to the bisector, `maxReach` along it. Solving each
    // shifted edge against that cut directly beats a second lineIntersection
    // call, which would have to build the cut from two nearby points and lose
    // precision doing it.
    let bx = (hit.x - v.x) / reach
    let by = (hit.y - v.y) / reach
    out.append(cutEdge(cur.p, cur.q, v.x, v.y, bx, by, maxReach) ?? cur.q)
    out.append(cutEdge(next.p, next.q, v.x, v.y, bx, by, maxReach) ?? next.p)
  }
  return out
}

/// Where the line through ab meets the cut perpendicular to the unit bisector.
private func cutEdge(_ a: Point, _ b: Point, _ vx: Double, _ vy: Double,
                     _ bx: Double, _ by: Double, _ reach: Double) -> Point? {
  let ux = b.x - a.x
  let uy = b.y - a.y
  let along = ux * bx + uy * by
  if along == 0 { return nil }
  let t = (reach - ((a.x - vx) * bx + (a.y - vy) * by)) / along
  return Point(a.x + t * ux, a.y + t * uy)
}

/// Intersection of the infinite lines through p1p2 and p3p4, or nil if parallel.
public func lineIntersection(_ p1: Point, _ p2: Point, _ p3: Point, _ p4: Point) -> Point? {
  let d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if d == 0 { return nil }
  let a = p1.x * p2.y - p1.y * p2.x
  let b = p3.x * p4.y - p3.y * p4.x
  return Point(
    (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d,
    (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d)
}
