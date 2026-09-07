import Foundation

/// Walls that touch or overlap, gathered into one group. Ports `src/state/groups.ts`.
///
/// Shapes drawn against each other should read as a single object, which is
/// what the dashed outline conveys. That used to be achieved by merging them
/// into one `Wall`, but merging cascades: draw anything against an enclosure
/// and the enclosure is swallowed. Grouping gives the same picture while every
/// shape keeps its own identity -- and it is recomputed from scratch whenever
/// walls change, so unlike merging it can never accumulate.
///
/// Border frames are the one exception and are skipped entirely. A frame's hull
/// is the solid rectangle it encloses, so it would draw the room's walkable
/// interior as if it were the obstacle -- and since a frame reaches all the way
/// round the map, everything inside it touches it and would collapse into that
/// single hull.
public struct WallGroup {
  /// Every wall in the group, lowest id first.
  public var wallIds: [Int]
  /// Convex hull over every point of every wall in the group.
  public var hull: [Point]
}

/// How close two walls must come to count as touching, in world units.
public let GROUP_TOLERANCE: Double = 1

private func wallsTouchWithin(_ a: Wall, _ b: Wall, _ tolerance: Double) -> Bool {
  for pa in a.polygons {
    for pb in b.polygons {
      if polygonsOverlap(pa, pb) { return true }
      for i in 0..<pa.count {
        let a1 = pa[i]
        let a2 = pa[(i + 1) % pa.count]
        for j in 0..<pb.count {
          let b1 = pb[j]
          let b2 = pb[(j + 1) % pb.count]
          if segmentDistance(a1, a2, b1, b2) <= tolerance { return true }
        }
      }
    }
  }
  return false
}

public func groupWalls(_ allWalls: [Wall], _ tolerance: Double = GROUP_TOLERANCE) -> [WallGroup] {
  let walls = allWalls.filter { !$0.isBorder }
  let n = walls.count
  if n == 0 { return [] }

  // Union-find over touching pairs.
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
      if wallsTouchWithin(walls[i], walls[j], tolerance) { parent[find(i)] = find(j) }
    }
  }

  // Insertion-ordered buckets: JS `Map` preserves the order roots are first
  // seen, and the groups are sorted by lowest id at the end anyway -- but the
  // hull points are gathered in member order, so the order matters to the
  // hull's input and therefore to nothing observable. Kept ordered regardless,
  // for the same reason Navigation.fieldOrder is.
  var rootOrder: [Int] = []
  var byRoot: [Int: [Int]] = [:]
  for i in 0..<n {
    let root = find(i)
    if byRoot[root] == nil { rootOrder.append(root); byRoot[root] = [] }
    byRoot[root]!.append(i)
  }

  var groups: [WallGroup] = []
  for root in rootOrder {
    let members = byRoot[root]!
    var points: [Point] = []
    for i in members { points.append(contentsOf: walls[i].polygons.flatMap { $0 }) }
    // Sorted so the lowest id is first: the outline's colour comes from the
    // first member, and must not change as unrelated shapes are added elsewhere.
    groups.append(WallGroup(wallIds: members.map { walls[$0].id }.sorted(),
                            hull: monotoneChainHull(points)))
  }
  return groups.sorted { $0.wallIds[0] < $1.wallIds[0] }
}
