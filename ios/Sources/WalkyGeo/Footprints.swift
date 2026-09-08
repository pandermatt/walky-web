import Foundation
import WalkySim

/// One building outline, as OpenStreetMap drew it.
public struct Footprint: Equatable, Sendable {
  public var ring: [Coordinate]
  public var name: String?
  public init(ring: [Coordinate], name: String? = nil) {
    self.ring = ring
    self.name = name
  }
}

/// Footprints as the polygons `Wall` takes.
///
/// Deliberately *not* simplified. `simplifyPolyline` is what a freehand stroke
/// needs -- hundreds of points from one gesture -- and a surveyed building is
/// already minimal: measured over the three extracts the 2016 app shipped,
/// Ramer-Douglas-Peucker at half a metre removed 2% of vertices and 3% of the
/// navigation rebuild. It is not the lever, and running it would only add a
/// tolerance that can round a real corner off. See `ios/README.md`.
///
/// What the ring needs is smaller and duller: OpenStreetMap closes a way by
/// repeating its first node, and a polygon that repeats a vertex puts a
/// zero-length edge into the visibility graph.
public func footprintPolygons(_ footprints: [Footprint], _ anchor: GeoAnchor) -> [[Point]] {
  var out: [[Point]] = []
  out.reserveCapacity(footprints.count)
  for footprint in footprints {
    var ring = footprint.ring.map { anchor.world($0) }
    if let first = ring.first, let last = ring.last, first == last { ring.removeLast() }
    // A ring of two points is a line, and a wall needs an inside.
    if ring.count >= 3 { out.append(ring) }
  }
  return out
}

/// How much a set of footprints will cost the navigation rebuild.
///
/// The rebuild is superquadratic in the number of wall corners -- measured at
/// about `n^2.5` -- so an import that is merely twice as wide is thirty times
/// the work. This is the number an import is allowed or refused on, rather than
/// a distance in metres: building density varies by a factor of two between a
/// Winterthur terrace and its outskirts, so a box that is comfortable in one
/// place is a five-second freeze in the other.
public enum ImportBudget {
  /// Corners the visibility sweep can take while a wall edit still feels like
  /// an edit rather than a hang -- about 150ms on the machine this was measured
  /// on. See `walky-geobench` and the table in `ios/README.md`.
  public static let maxVertices = 1000

  public static func vertices(_ polygons: [[Point]]) -> Int {
    polygons.reduce(0) { $0 + $1.count }
  }

  public static func fits(_ polygons: [[Point]]) -> Bool {
    vertices(polygons) <= maxVertices
  }
}

// MARK: - Merging

/// How much bigger a cluster's convex hull may be than the shapes inside it
/// before merging them is refused, as a fraction.
///
/// This is the whole of the fidelity decision. A terrace hulls to almost
/// exactly its own footprint, so it passes and collapses to a few corners. A
/// ring of buildings round a courtyard does not -- its hull swallows the
/// courtyard -- so it fails and the buildings stay as they were surveyed, and
/// the crowd can still walk in.
public let MERGE_SLACK: Double = 0.15

/// Past this many corners a ring is not a surveyed building but a traced curve.
///
/// Ordinary buildings are left exactly as OpenStreetMap drew them, and the
/// comment above `footprintPolygons` says why: measured over the extracts the
/// 2016 app shipped, Ramer-Douglas-Peucker at half a metre removed 2% of
/// vertices. That average is over data which is mostly already minimal, and it
/// says nothing about the part which is not -- a church, a station, or any
/// curved facade arrives with thirty to a hundred nodes, and a handful of those
/// can eat a whole `ImportBudget`. So the threshold is high enough that a house
/// never reaches it.
public let SIMPLIFY_ABOVE: Int = 12

/// Fewer, simpler shapes for the same buildings.
///
/// Three passes, cheapest first, each of which only ever removes corners:
///
/// 1. **Simplify the outliers.** See `SIMPLIFY_ABOVE`.
/// 2. **Drop rings inside other rings.** OpenStreetMap carries a `building`
///    outline with `building:part` polygons drawn on top of it for 3D detail,
///    and both come back from `way["building"]`. The parts describe a building
///    the outline already describes, and they are charged to the budget twice.
/// 3. **Hull a cluster of touching shapes, when the hull barely grows it.**
///
/// `tolerance` is how close two rings must come to count as touching, in world
/// units, and defaults to the same `GROUP_TOLERANCE` the renderer's grouping
/// uses -- the two are asking the same question about the same map.
public func mergeFootprints(_ polygons: [[Point]],
                            tolerance: Double = 1,
                            simplifyTolerance: Double = 0) -> [[Point]] {
  var rings = polygons
  if simplifyTolerance > 0 {
    rings = rings.map { ring in
      guard ring.count > SIMPLIFY_ABOVE else { return ring }
      let simpler = simplifyClosed(ring, simplifyTolerance)
      // Simplification may not turn a building into a line.
      return simpler.count >= 3 ? simpler : ring
    }
  }

  rings = dropContained(rings)
  guard rings.count > 1 else { return rings }

  var out: [[Point]] = []
  out.reserveCapacity(rings.count)
  for cluster in clusters(of: rings, tolerance: tolerance) {
    guard cluster.count > 1 else {
      out.append(rings[cluster[0]])
      continue
    }
    let members = cluster.map { rings[$0] }
    let hull = monotoneChainHull(members.flatMap { $0 })
    if hull.count >= 3, hullIsTight(hull, members) {
      out.append(hull)
    } else {
      out.append(contentsOf: members)
    }
  }
  return out
}

/// Whether a hull is close enough to the shapes it covers to stand in for them.
///
/// The denominator over-counts where members overlap, because shared area is
/// summed twice. That makes the test permissive exactly for heavily overlapping
/// clusters -- which are duplicates of one building, the case most worth
/// merging -- and accurate for merely touching ones, where the areas are
/// disjoint and the sum is the union. The gap it leaves is a cluster that both
/// overlaps heavily *and* encloses a courtyard; that is rare enough to name
/// rather than to build machinery for.
private func hullIsTight(_ hull: [Point], _ members: [[Point]]) -> Bool {
  let covered = members.reduce(0.0) { $0 + abs(signedArea2($1)) / 2 }
  guard covered > 0 else { return false }
  return abs(signedArea2(hull)) / 2 <= covered * (1 + MERGE_SLACK)
}

/// Rings wholly inside another ring, removed.
///
/// By every vertex rather than by one: a ring can have a vertex inside another
/// while crossing it, and that is an overlap for the clusterer to judge, not a
/// duplicate to delete.
private func dropContained(_ rings: [[Point]]) -> [[Point]] {
  let boxes = rings.map(boxOf)
  var drop = Array(repeating: false, count: rings.count)
  for i in 0..<rings.count where !drop[i] {
    for j in 0..<rings.count where i != j && !drop[j] {
      // Only a strictly larger box can contain another, which also settles the
      // tie between two identical rings: exactly one of them is dropped.
      if !boxContains(boxes[j], boxes[i]) { continue }
      if boxes[i] == boxes[j] && j > i { continue }
      if rings[i].allSatisfy({ pointInPolygon(rings[j], $0) }) {
        drop[i] = true
        break
      }
    }
  }
  return rings.enumerated().filter { !drop[$0.offset] }.map { $0.element }
}

/// Indices of rings that touch or overlap, gathered by union-find.
///
/// The same predicate and the same union-find as `groupWalls`, with one
/// addition that matters here and not there: a bounding-box test before the
/// polygon one. `groupWalls` runs over a hand-drawn map of a few dozen walls;
/// this runs over a few hundred buildings, where the O(n^2) pass of
/// edge-against-edge distance is the difference between an import and a hang.
private func clusters(of rings: [[Point]], tolerance: Double) -> [[Int]] {
  let n = rings.count
  let boxes = rings.map(boxOf)
  var parent = Array(0..<n)
  func find(_ start: Int) -> Int {
    var root = start
    while parent[root] != root { root = parent[root] }
    var i = start
    while parent[i] != root { let next = parent[i]; parent[i] = root; i = next }
    return root
  }
  for i in 0..<n {
    for j in (i + 1)..<n {
      if find(i) == find(j) { continue }
      if !boxesTouch(boxes[i], boxes[j], tolerance) { continue }
      if ringsTouch(rings[i], rings[j], tolerance) { parent[find(i)] = find(j) }
    }
  }

  var byRoot: [Int: [Int]] = [:]
  for i in 0..<n { byRoot[find(i), default: []].append(i) }
  // Sorted so the output order is the input order, which keeps the result
  // reproducible and the tests readable.
  return byRoot.values.sorted { $0[0] < $1[0] }
}

private func ringsTouch(_ a: [Point], _ b: [Point], _ tolerance: Double) -> Bool {
  if polygonsOverlap(a, b) { return true }
  for i in 0..<a.count {
    let a1 = a[i], a2 = a[(i + 1) % a.count]
    for j in 0..<b.count {
      let b1 = b[j], b2 = b[(j + 1) % b.count]
      if segmentDistance(a1, a2, b1, b2) <= tolerance { return true }
    }
  }
  return false
}

private struct Box: Equatable {
  var minX = Double.infinity, minY = Double.infinity
  var maxX = -Double.infinity, maxY = -Double.infinity
}

private func boxOf(_ ring: [Point]) -> Box {
  var b = Box()
  for p in ring {
    if p.x < b.minX { b.minX = p.x }
    if p.x > b.maxX { b.maxX = p.x }
    if p.y < b.minY { b.minY = p.y }
    if p.y > b.maxY { b.maxY = p.y }
  }
  return b
}

private func boxesTouch(_ a: Box, _ b: Box, _ tolerance: Double) -> Bool {
  a.minX - tolerance <= b.maxX && b.minX - tolerance <= a.maxX
    && a.minY - tolerance <= b.maxY && b.minY - tolerance <= a.maxY
}

private func boxContains(_ outer: Box, _ inner: Box) -> Bool {
  outer.minX <= inner.minX && outer.maxX >= inner.maxX
    && outer.minY <= inner.minY && outer.maxY >= inner.maxY
}
