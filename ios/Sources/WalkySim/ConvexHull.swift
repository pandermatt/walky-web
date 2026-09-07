import Foundation

/// Andrew's monotone chain convex hull, O(n log n). Ports `src/sim/convexHull.ts`.
///
/// Returns a *strictly* convex hull: collinear points along an edge are
/// dropped, which is what makes the offset step in `expandPolygon` well defined.
///
/// JS `Array.sort` is stable and Swift's `sorted` is not, which does not matter
/// here: the comparator is a total order on distinct points, and exact
/// duplicates are dropped immediately afterwards, so no two elements that
/// compare equal survive to be distinguished.
public func monotoneChainHull(_ points: [Point]) -> [Point] {
  if points.isEmpty { return [] }

  let pts = points.sorted { a, b in a.x != b.x ? a.x < b.x : a.y < b.y }
  var uniq: [Point] = []
  uniq.reserveCapacity(pts.count)
  for p in pts {
    if let last = uniq.last, last.x == p.x, last.y == p.y { continue }
    uniq.append(p)
  }
  let n = uniq.count
  if n < 3 { return uniq.map { Point($0.x, $0.y) } }

  func build(_ src: [Point]) -> [Point] {
    var chain: [Point] = []
    chain.reserveCapacity(src.count)
    for p in src {
      // <= 0 drops collinear points, giving a strictly convex hull.
      while chain.count >= 2 && orient(chain[chain.count - 2], chain[chain.count - 1], p) <= 0 {
        chain.removeLast()
      }
      chain.append(p)
    }
    chain.removeLast()   // the last point belongs to the other chain
    return chain
  }

  let hull = build(uniq) + build(uniq.reversed())

  // All input collinear: both chains collapse to the two extreme points.
  if hull.count < 3 {
    return [Point(uniq[0].x, uniq[0].y), Point(uniq[n - 1].x, uniq[n - 1].y)]
  }
  return hull.map { Point($0.x, $0.y) }
}
