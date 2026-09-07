import Testing
import Foundation
@testable import WalkyCore

/// Ported from `web/src/__tests__/groups.test.ts`.

private let SLATE: RGB = (110, 120, 160)

@MainActor
private func wall(_ polygons: [[Point]]) -> Wall {
  makeWall(polygons, WallOptions(color: SLATE))
}

@MainActor
private func rect(_ a: Point, _ b: Point) -> Wall {
  wall([rectanglePolygon(a, b)])
}

@Suite("groupWalls")
@MainActor
struct GroupsTests {
  @Test("puts overlapping shapes in one group")
  func overlapping() {
    let a = rect(Point(0, 0), Point(100, 100))
    let b = rect(Point(80, 80), Point(180, 180))
    let groups = groupWalls([a, b])
    #expect(groups.count == 1)
    #expect(groups[0].wallIds == [a.id, b.id].sorted())
  }

  @Test("puts shapes that merely touch in one group")
  func touching() {
    let a = rect(Point(0, 0), Point(100, 100))
    let b = rect(Point(100, 0), Point(200, 100))
    #expect(groupWalls([a, b]).count == 1)
  }

  @Test("keeps shapes with a clear gap apart")
  func apart() {
    let a = rect(Point(0, 0), Point(100, 100))
    let b = rect(Point(140, 0), Point(240, 100))
    #expect(groupWalls([a, b]).count == 2)
  }

  @Test("is transitive: A touches B, B touches C, all one group")
  func transitive() {
    let a = rect(Point(0, 0), Point(100, 50))
    let b = rect(Point(90, 0), Point(190, 50))
    let c = rect(Point(180, 0), Point(280, 50))
    let groups = groupWalls([a, b, c])
    #expect(groups.count == 1)
    #expect(groups[0].wallIds.count == 3)
    // A and C do not touch each other; they are joined only through B.
    #expect(groupWalls([a, c]).count == 2)
  }

  @Test("the hull contains every point of every member")
  func hullContains() {
    let a = rect(Point(0, 0), Point(100, 100))
    let b = rect(Point(80, 80), Point(180, 180))
    let group = groupWalls([a, b])[0]
    for w in [a, b] {
      for p in w.polygons.flatMap({ $0 }) {
        let inside = pointInPolygon(group.hull, p)
        let onEdge = group.hull.indices.contains { i in
          let h = group.hull[i], q = group.hull[(i + 1) % group.hull.count]
          return abs((q.x - h.x) * (p.y - h.y) - (q.y - h.y) * (p.x - h.x)) < 1e-6
        }
        #expect(inside || onEdge)
      }
    }
  }

  @Test("groups the shapes of a multi-polygon wall as one, since it is one wall")
  func multiPolygon() {
    let twoBars = wall([rectanglePolygon(Point(0, 0), Point(400, 12)),
                        rectanglePolygon(Point(0, 288), Point(400, 300))])
    #expect(groupWalls([twoBars]).count == 1)
  }

  @Test("handles an empty map")
  func empty() { #expect(groupWalls([]).isEmpty) }

  @Test("outlines a shape that touches nothing, on its own")
  func alone() {
    let trace = [Point(0, 0), Point(100, 0), Point(100, 100), Point(40, 60), Point(0, 100)]
    let freehand = wall([trace])
    let groups = groupWalls([freehand])
    #expect(groups.count == 1)
    #expect(groups[0].wallIds == [freehand.id])
    #expect(groups[0].hull == monotoneChainHull(trace))
  }

  @Test("lets a traced shape join two others under one outline")
  func bridge() {
    let left = rect(Point(0, 0), Point(100, 100))
    let right = rect(Point(300, 0), Point(400, 100))
    let span = wall([[Point(90, 40), Point(310, 40), Point(310, 200), Point(90, 200)]])

    // Apart, the two rectangles are two outlines.
    #expect(groupWalls([left, right]).count == 2)
    let groups = groupWalls([left, right, span])
    #expect(groups.count == 1)
    #expect(groups[0].wallIds.count == 3)
    #expect(groups[0].hull == monotoneChainHull(
      left.polygons.flatMap { $0 } + right.polygons.flatMap { $0 } + span.polygons.flatMap { $0 }))
  }

  @Test("leaves a border frame out entirely, so what it encloses keeps its own outline")
  func bordersExcluded() {
    // A frame's hull is the room it encloses, and it reaches round the whole
    // map -- grouped, its outline would be the only one left.
    let frame = makeWall(borderFrame(Point(-500, -500), Point(500, 500), 12),
                         WallOptions(color: SLATE, isBorder: true))
    let inside = rect(Point(-50, -50), Point(50, 50))
    let groups = groupWalls([frame, inside])
    #expect(groups.count == 1)
    #expect(groups[0].wallIds == [inside.id])
  }
}
