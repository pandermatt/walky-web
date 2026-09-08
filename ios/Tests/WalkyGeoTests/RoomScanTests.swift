import Testing
import Foundation
import WalkySim
@testable import WalkyGeo

private let radius = 13.0

/// Everything about a room scan that can be checked without LiDAR -- which is
/// everything except the capture view itself, and is why the conversion lives
/// in this target rather than in the app.
@Suite("Scanning a room")
struct RoomScanTests {
  private func imported(_ options: RoomOptions = RoomOptions()) -> RoomImport {
    roomWalls(.sample, options)
  }

  /// Is a point somewhere a pedestrian's centre could be? The same question
  /// `Behaviour.insideAnyWall` asks, and asked the same way: against the hulls
  /// after navigation has inflated them by one radius.
  private func standable(_ p: Point, _ result: RoomImport, _ r: Double = radius) -> Bool {
    for shape in result.walls + result.furniture {
      for polygon in shape {
        let hull = monotoneChainHull(polygon)
        guard hull.count >= 3 else { continue }
        if pointInPolygon(expandPolygon(hull, r), p) { return false }
      }
    }
    return true
  }

  @Test("four walls come back as four walls, however many holes are cut in them")
  func oneWallStaysOneWall() {
    let result = imported()
    // One wall per scanned wall: the north wall is two bars around its door and
    // the west wall is two around its opening, but a wall is one object, one
    // undo step and one shell for the visibility sweep.
    #expect(result.walls.count == 4)
    let bars = result.walls.map(\.count).sorted()
    #expect(bars == [1, 1, 2, 2])
    for shape in result.walls {
      for polygon in shape { #expect(polygon.count == 4) }
    }
  }

  @Test("a doorway is a hole somebody can walk through")
  func doorwayIsAGap() {
    let result = imported()
    let door = try! #require(result.doorways.first { $0.kind == .door })

    // The middle of the doorway is not inside any wall, at the shipped radius.
    #expect(standable(door.at, result))
    // And its frame is: a step to either side along the wall is solid.
    #expect(!standable(Point(door.at.x - 40, door.at.y), result))
    #expect(!standable(Point(door.at.x + 40, door.at.y), result))
  }

  @Test("a 0.9m door admits a pedestrian and a 0.4m one does not")
  func widthDecidesPassage() {
    // The measurement this whole feature rests on. `Behaviour.insideAnyWall`
    // tests an agent's centre against radius-inflated hulls, so a gap admits
    // somebody above 2 * radius -- 26 units, or 0.46m at 1:1.
    #expect(!gapSeals(0.9 * PX_PER_METRE, radius))
    #expect(gapSeals(0.4 * PX_PER_METRE, radius))

    // And the same answer through the geometry rather than the arithmetic: a
    // door narrowed to 0.4m has no standable point in it.
    var narrow = ScannedRoom.sample
    for i in narrow.rects.indices where narrow.rects[i].kind == .door {
      narrow.rects[i].width = 0.4
    }
    let sealed = roomWalls(narrow)
    let door = try! #require(sealed.doorways.first { $0.kind == .door })
    #expect(!standable(door.at, sealed))
  }

  @Test("the room is not mirrored")
  func orientation() {
    // The sample's door is in the north wall, and north is -z. A handedness
    // slip between RoomPlan's y-up metres and Walky's y-down world would put it
    // in the south wall, and every other test here would still pass.
    let result = imported()
    let door = try! #require(result.doorways.first { $0.kind == .door })
    #expect(door.at.y < 0)
    // A metre east of the middle stays east.
    #expect(door.at.x > 0)
    #expect(abs(door.at.x - PX_PER_METRE) < 2)
  }

  @Test("a doorway knows which way the room is")
  func inwardPointsIndoors() {
    let result = imported()
    let door = try! #require(result.doorways.first { $0.kind == .door })
    let inward = try! #require(door.inward)

    // The door is in the north wall, so indoors is south: +y.
    #expect(inward.y > 0.9)
    // And a Walky door placed a stride inside stands on floor, not in a wall.
    let inside = Point(door.at.x + inward.x * 60, door.at.y + inward.y * 60)
    #expect(standable(inside, result))
  }

  @Test("a window stays solid")
  func windowsAreWalls() {
    let result = imported()
    // The sample's window is in the middle of the south wall. Walking out of a
    // first-floor window is a bug, not a feature.
    #expect(result.doorways.allSatisfy { $0.kind != .window })
    let south = Point(0, 5.0 / 2 * PX_PER_METRE)
    #expect(!standable(south, result))
  }

  @Test("furniture is optional, and off means walls only")
  func furnitureToggle() {
    let with = imported(RoomOptions(includeFurniture: true))
    let without = imported(RoomOptions(includeFurniture: false))

    #expect(with.furniture.count == 3)          // a table and two chairs
    #expect(without.furniture.isEmpty)
    #expect(with.walls.count == without.walls.count)

    // The table is in the middle and turned off the axis, so it is the one that
    // proves the rotation is applied rather than assumed.
    let middle = Point(0.2 * PX_PER_METRE, 0.3 * PX_PER_METRE)
    #expect(!standable(middle, with))
    #expect(standable(middle, without))
  }

  @Test("what the scanner was unsure about can be dropped")
  func confidence() {
    var doubtful = ScannedRoom.sample
    for i in doubtful.rects.indices where doubtful.rects[i].kind == .object {
      doubtful.rects[i].confident = false
    }
    #expect(roomWalls(doubtful, RoomOptions(confidentOnly: true)).furniture.isEmpty)
    #expect(roomWalls(doubtful, RoomOptions(confidentOnly: false)).furniture.count == 3)
  }

  @Test("a room is nowhere near the import budget")
  func budget() {
    // The refusal path exists for a 600m city import at n^2.5. A room is tens
    // of corners, so it is unreachable here -- asserted rather than assumed,
    // because it is the reason none of that machinery is wired up.
    let result = imported()
    #expect(result.wallCorners < 100)
    #expect(ImportBudget.fits(result.walls.flatMap { $0 }))
  }

  @Test("the floor stays walkable -- the room is not hulled shut")
  func interiorIsWalkable() {
    // `mergeFootprints` hulls clusters of touching shapes, and the walls of a
    // room all touch, so applying it would replace the room with a solid block.
    // This is the failure that would cause, asserted directly.
    let result = imported(RoomOptions(includeFurniture: false))
    for spot in [Point(0, 0), Point(-60, 100), Point(80, -100)] {
      #expect(standable(spot, result), "\(spot) should be floor")
    }
  }

  @Test("it reports the room's real size, and places it at life size")
  func metres() {
    let result = imported()
    // 5m deep plus the walls' own thickness, so a little over.
    #expect(abs(result.metresAcross - 5) < 0.4)

    // Life size, which for a room is the only ratio worth having: a
    // pedestrian's 26 units fit eight times across 4m of room, and a
    // scaled-down room would be narrower than the people in it. Measured
    // across the outer faces, so it is the 4m room plus one wall thickness.
    let outer = (4 + WALL_THICKNESS) * PX_PER_METRE
    #expect(abs(span(result) - outer) < 4)
  }

  @Test("a scan survives a round trip through JSON")
  func codable() throws {
    // What lets a room be placed again without walking round it a second time.
    let data = try JSONEncoder().encode(ScannedRoom.sample)
    let back = try JSONDecoder().decode(ScannedRoom.self, from: data)
    #expect(back == ScannedRoom.sample)
  }

  private func span(_ result: RoomImport) -> Double {
    var minX = Double.infinity, maxX = -Double.infinity
    for shape in result.walls {
      for polygon in shape {
        for p in polygon { minX = jsMin(minX, p.x); maxX = jsMax(maxX, p.x) }
      }
    }
    return maxX - minX
  }
}
