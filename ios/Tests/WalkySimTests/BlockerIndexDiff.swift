import Testing
import Foundation
@testable import WalkySim

/// The index may not change a single answer. This asks it directly, rather than
/// waiting for a fixture to diverge 300 ticks in and guessing why.
@Suite("Blocker index agrees with the linear scan")
struct BlockerIndexDiff {
  /// The scan `isVisible` used to be, kept here as the reference.
  private func linearVisible(_ a: Point, _ b: Point, _ blockers: Blockers) -> Bool {
    let mid = Point((a.x + b.x) / 2, (a.y + b.y) / 2)
    for group in blockers.groups {
      if let shell = group.shell {
        if jsMax(a.x, b.x) < shell.bbox.minX || jsMin(a.x, b.x) > shell.bbox.maxX
          || jsMax(a.y, b.y) < shell.bbox.minY || jsMin(a.y, b.y) > shell.bbox.maxY { continue }
        var touches = false
        let h = shell.hull
        for i in 0..<h.count where segmentsCross(a, b, h[i], h[(i + 1) % h.count]) {
          touches = true
        }
        if !touches && !(pointInPolygon(h, a) || pointInPolygon(h, b) || pointInPolygon(h, mid)) {
          continue
        }
      }
      for ob in group.parts {
        if jsMax(a.x, b.x) < ob.bbox.minX || jsMin(a.x, b.x) > ob.bbox.maxX
          || jsMax(a.y, b.y) < ob.bbox.minY || jsMin(a.y, b.y) > ob.bbox.maxY { continue }
        let hull = ob.hull
        var onOutline = false
        for i in 0..<hull.count {
          let p = hull[i], q = hull[(i + 1) % hull.count]
          if segmentsCross(a, b, p, q) { return false }
          if !onOutline && pointSegmentDistance(p, q, mid) <= 1e-9 { onOutline = true }
        }
        if !onOutline && pointInPolygon(hull, mid) { return false }
      }
    }
    return true
  }

  /// Whether the segment itself, not just its bounding box, meets the box.
  private func segmentMeetsBox(_ a: Point, _ b: Point, _ box: BBox) -> Bool {
    let corners = [Point(box.minX, box.minY), Point(box.maxX, box.minY),
                   Point(box.maxX, box.maxY), Point(box.minX, box.maxY)]
    if a.x >= box.minX && a.x <= box.maxX && a.y >= box.minY && a.y <= box.maxY { return true }
    if b.x >= box.minX && b.x <= box.maxX && b.y >= box.minY && b.y <= box.maxY { return true }
    for i in 0..<4 where segmentsCross(a, b, corners[i], corners[(i + 1) % 4]) { return true }
    return false
  }

  private func scatteredWalls() -> [Wall] {
    var walls: [Wall] = []
    var id = 0
    for row in 0..<5 {
      for col in 0..<5 {
        let x = -600.0 + Double(col) * 260
        let y = -600.0 + Double(row) * 260
        walls.append(Wall(id: id, polygons: [rectanglePolygon(Point(x, y), Point(x + 120, y + 90))]))
        id += 1
      }
    }
    return walls
  }

  @Test("every segment gets the same answer, including from outside the map")
  func segmentsAgree() {
    let graph = buildVisibilityGraph(scatteredWalls(), 13)
    let blockers = graph.blockers
    let index = BlockerIndex()
    index.build(blockers.groups)

    // A deterministic spread, deliberately reaching well outside the grid --
    // pedestrians stand outside the buildings' bounding box constantly.
    var seed: UInt64 = 12345
    func next() -> Double {
      seed = seed &* 6364136223846793005 &+ 1442695040888963407
      return Double(seed >> 11) / Double(UInt64(1) << 53)
    }
    var mismatches = 0
    for _ in 0..<20000 {
      let a = Point(-1400 + next() * 2800, -1400 + next() * 2800)
      let b = Point(-1400 + next() * 2800, -1400 + next() * 2800)
      // The index's segment walk, held to the linear scan even though
      // `isVisible` no longer uses it: it is what a short-segment fast path
      // would be built on, and a walk that skips cells is the bug that cost
      // three fixtures once already.
      let n = index.query(a, b)
      var reachable = Set<Int32>()
      for k in 0..<n { reachable.insert(index.results[k]) }
      for (g, group) in blockers.groups.enumerated() {
        var box = group.shell?.bbox
          ?? BBox(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
        for part in group.parts {
          box.minX = Swift.min(box.minX, part.bbox.minX)
          box.minY = Swift.min(box.minY, part.bbox.minY)
          box.maxX = Swift.max(box.maxX, part.bbox.maxX)
          box.maxY = Swift.max(box.maxY, part.bbox.maxY)
        }
        guard box.minX.isFinite else { continue }
        // A group the segment's own bounding box meets must be offered.
        let meets = !(jsMax(a.x, b.x) < box.minX || jsMin(a.x, b.x) > box.maxX
                   || jsMax(a.y, b.y) < box.minY || jsMin(a.y, b.y) > box.maxY)
        if meets && !reachable.contains(Int32(g)) {
          // Only a real miss if the segment truly crosses that box.
          if segmentMeetsBox(a, b, box) { mismatches += 1 }
        }
      }
      if isVisible(a, b, blockers) != linearVisible(a, b, blockers) {
        mismatches += 1
        if mismatches == 1 {
          Issue.record("first mismatch: \(a) -> \(b)")
        }
      }
    }
    #expect(mismatches == 0, "\(mismatches) of 20000 segments disagree")
  }

  @Test("every point gets the same set of candidate groups")
  func pointsAgree() {
    let graph = buildVisibilityGraph(scatteredWalls(), 13)
    let blockers = graph.blockers
    let index = BlockerIndex()
    index.build(blockers.groups)
    var seed: UInt64 = 999
    func next() -> Double {
      seed = seed &* 6364136223846793005 &+ 1442695040888963407
      return Double(seed >> 11) / Double(UInt64(1) << 53)
    }
    var mismatches = 0
    for _ in 0..<20000 {
      let p = Point(-1400 + next() * 2800, -1400 + next() * 2800)

      var linear = false
      for ob in blockers.obstacles {
        if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
          || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { continue }
        if pointInPolygon(ob.hull, p) { linear = true; break }
      }

      var indexed = false
      let n = index.query(p)
      for k in 0..<n {
        for ob in blockers.groups[Int(index.results[k])].parts {
          if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
            || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { continue }
          if pointInPolygon(ob.hull, p) { indexed = true; break }
        }
        if indexed { break }
      }
      if linear != indexed { mismatches += 1 }
    }
    #expect(mismatches == 0, "\(mismatches) of 20000 points disagree")
  }

  /// The property `Behaviour.primeNearby` rests on.
  ///
  /// It asks the index once for a box covering all nine candidate positions of
  /// a substep and reuses the answer for each. That is only exact if the box
  /// answer *contains* every per-point answer -- a candidate straddling a cell
  /// boundary must still find its group, which is the case a single-point
  /// prime would quietly miss.
  @Test("a box query contains every point query inside it")
  func boxContainsPoints() {
    let graph = buildVisibilityGraph(scatteredWalls(), 13)
    let index = BlockerIndex()
    index.build(graph.blockers.groups)

    var seed: UInt64 = 4242
    func next() -> Double {
      seed = seed &* 6364136223846793005 &+ 1442695040888963407
      return Double(seed >> 11) / Double(UInt64(1) << 53)
    }

    // The real geometry: a step is at most sqrt(2), so the box is tiny against
    // a cell -- but it is deliberately walked across boundaries here.
    let step = 1.4142135623730951
    for _ in 0..<5000 {
      let c = Point(-1400 + next() * 2800, -1400 + next() * 2800)

      let boxN = index.query(minX: c.x - step, minY: c.y - step,
                             maxX: c.x + step, maxY: c.y + step)
      var box = Set<Int32>()
      for k in 0..<boxN { box.insert(index.results[k]) }

      // Every corner and the centre, which is where the nine candidates live.
      for p in [c, Point(c.x - step, c.y - step), Point(c.x + step, c.y - step),
                Point(c.x - step, c.y + step), Point(c.x + step, c.y + step)] {
        let n = index.query(p)
        for k in 0..<n {
          #expect(box.contains(index.results[k]),
                  "box at \(c) missed group \(index.results[k]) found at \(p)")
        }
      }
    }
  }
}
