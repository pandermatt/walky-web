import Foundation

/// Splits a simple polygon into convex parts. Ports `src/sim/convexDecompose.ts`.
///
/// Needed because one convex hull per wall fills in any concavity. A U-shaped
/// wall hulls to a solid rectangle, so its cavity becomes unreachable -- a goal
/// placed inside can never be routed to, because every one of its graph nodes
/// is dropped for sitting inside the U's hull.
///
/// Ear-clip to triangles, then merge neighbours back while the union stays
/// convex (Hertel-Mehlhorn). Which ear gets clipped matters more than it looks:
/// the pieces feed `expandPolygon`, and a needle triangle offset by a
/// pedestrian radius produces a corner far out in open ground, which then reads
/// as solid. Clipping the roundest available ear keeps the pieces fat.
///
/// `smallestAngle` calls `jsAcos`, and V8 and Darwin's libm disagree on 15% of
/// `acos` inputs. That is why CWalkyMath exists: a different `acos` here ranks
/// ears differently, which splits walls differently, which builds a different
/// visibility graph, which sends the whole crowd somewhere else.

private func area2(_ poly: [Point]) -> Double { abs(signedArea2(poly)) }

public func isConvex(_ poly: [Point]) -> Bool {
  let n = poly.count
  if n < 4 { return true }
  var sign = 0
  for i in 0..<n {
    let o = orient(poly[i], poly[(i + 1) % n], poly[(i + 2) % n])
    if o == 0 { continue }
    let s = o > 0 ? 1 : -1
    if sign == 0 { sign = s }
    else if s != sign { return false }
  }
  return true
}

private func pointInTriangle(_ p: Point, _ a: Point, _ b: Point, _ c: Point) -> Bool {
  let d1 = orient(a, b, p)
  let d2 = orient(b, c, p)
  let d3 = orient(c, a, p)
  let hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  let hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/// Smallest interior angle of a triangle, in radians. Zero for a degenerate one.
///
/// The standard mesh-quality measure, and exactly what the offset cares about,
/// since a corner's miter grows as `1 / sin(angle / 2)`.
private func smallestAngle(_ a: Point, _ b: Point, _ c: Point) -> Double {
  var smallest = Double.infinity
  let corners: [(Point, Point, Point)] = [(c, a, b), (a, b, c), (b, c, a)]
  for (prev, at, next) in corners {
    let ux = prev.x - at.x, uy = prev.y - at.y
    let vx = next.x - at.x, vy = next.y - at.y
    let lengths = jsHypot(ux, uy) * jsHypot(vx, vy)
    if lengths == 0 { return 0 }
    let cos = jsMin(1, jsMax(-1, (ux * vx + uy * vy) / lengths))
    smallest = jsMin(smallest, jsAcos(cos))
  }
  return smallest
}

/// Ear clipping. Expects a counter-clockwise, duplicate-free ring.
private func earClip(_ poly: [Point]) -> [[Point]] {
  var idx = Array(0..<poly.count)
  var out: [[Point]] = []
  var guardCount = 0

  while idx.count > 3 && guardCount < 10000 {
    guardCount += 1
    // Every valid ear is scored and the roundest wins, rather than taking the
    // first that fits. The scan already visits every corner to find one ear, so
    // ranking them costs a comparison per corner, not a pass.
    var best = -1
    var bestAngle = -1.0
    for k in 0..<idx.count {
      let prev = poly[idx[(k - 1 + idx.count) % idx.count]]
      let cur = poly[idx[k]]
      let next = poly[idx[(k + 1) % idx.count]]

      // A convex corner in a CCW ring turns left.
      if orient(prev, cur, next) <= 0 { continue }

      // No other vertex may sit inside the candidate ear.
      var clean = true
      var m = 0
      while m < idx.count && clean {
        if m == k || m == (k - 1 + idx.count) % idx.count || m == (k + 1) % idx.count {
          m += 1; continue
        }
        if pointInTriangle(poly[idx[m]], prev, cur, next) { clean = false }
        m += 1
      }
      if !clean { continue }

      let angle = smallestAngle(prev, cur, next)
      if angle > bestAngle { bestAngle = angle; best = k }
    }
    // Self-intersecting or otherwise degenerate: stop rather than spin. The
    // partial pieces that result under-fill the shape; deck.gl's earcut does
    // something else arbitrary there, so the two renderers differ on a
    // self-intersecting freehand trace. Accepted, and noted.
    if best < 0 { break }

    out.append([
      poly[idx[(best - 1 + idx.count) % idx.count]],
      poly[idx[best]],
      poly[idx[(best + 1) % idx.count]],
    ])
    idx.remove(at: best)
  }

  if idx.count >= 3 { out.append(idx.map { poly[$0] }) }
  return out.filter { area2($0) > 1e-9 }
}

private func sharesEdge(_ a: [Point], _ b: [Point]) -> Bool {
  var shared = 0
  for p in a {
    for q in b where p.x == q.x && p.y == q.y { shared += 1; break }
  }
  return shared >= 2
}

public func convexDecompose(_ polygon: [Point]) -> [[Point]] {
  // Drop consecutive duplicates.
  var ring: [Point] = []
  for p in polygon {
    if let last = ring.last, last.x == p.x, last.y == p.y { continue }
    ring.append(Point(p.x, p.y))
  }
  while ring.count > 1 {
    let first = ring[0]
    let last = ring[ring.count - 1]
    if first.x == last.x && first.y == last.y { ring.removeLast() } else { break }
  }
  if ring.count < 3 { return [] }
  if isConvex(ring) { return [ring] }

  // Ear clipping expects counter-clockwise.
  let ccw = signedArea2(ring) > 0 ? ring : ring.reversed().map { $0 }
  var pieces = earClip(ccw)
  if pieces.isEmpty { return [ccw] }

  // Merge neighbours while the union stays convex. The merged hull is appended
  // at the end and the two sources removed, so the ordering of `pieces` after a
  // merge is part of the algorithm, not an accident of it.
  var merged = true
  var guardCount = 0
  while merged && guardCount < 1000 {
    guardCount += 1
    merged = false
    outer: for i in 0..<pieces.count {
      for j in (i + 1)..<pieces.count {
        if !sharesEdge(pieces[i], pieces[j]) { continue }
        let hull = monotoneChainHull(pieces[i] + pieces[j])
        if hull.count < 3 { continue }
        let combined = area2(pieces[i]) + area2(pieces[j])
        // Equal areas means the hull adds nothing: the union is already convex.
        if abs(area2(hull) - combined) > 1e-6 * jsMax(1, combined) { continue }
        var next: [[Point]] = []
        for (k, piece) in pieces.enumerated() where k != i && k != j { next.append(piece) }
        next.append(hull)
        pieces = next
        merged = true
        break outer
      }
    }
  }
  return pieces
}
