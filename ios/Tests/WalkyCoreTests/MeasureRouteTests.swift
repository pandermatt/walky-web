import Testing
import Foundation
import WalkySim
@testable import WalkyCore

private let radius = 13.0

private func square(_ x: Double, _ y: Double, _ size: Double) -> [Point] {
  [Point(x, y), Point(x + size, y), Point(x + size, y + size), Point(x, y + size)]
}

private func wall(_ id: Int, _ ring: [Point]) -> Wall {
  Wall(id: id, polygons: [ring])
}

/// Walky's own A-to-B path, which the simulation has never had to answer before:
/// it routes to goal *walls*, and a measurement has no wall at either end.
@Suite("Measuring a route")
struct MeasureRouteTests {
  @Test("open ground is a straight line, and its length is the straight length")
  func openGround() throws {
    let graph = MeasuringGraph()
    let a = Point(0, 0), b = Point(560, 0)          // 10m apart at 56px/m
    let path = try #require(graph.route(from: a, to: b, walls: [], radius: radius, revision: 1))

    #expect(path == [a, b])
    #expect(abs(polylineMetres(path) - 10) < 1e-9)
  }

  @Test("a building in the way is walked around, not through")
  func aroundAWall() throws {
    let graph = MeasuringGraph()
    let a = Point(0, 0), b = Point(1000, 0)
    // Straddles the straight line from a to b.
    let blocker = wall(1, square(400, -200, 200))

    let path = try #require(graph.route(from: a, to: b, walls: [blocker],
                                        radius: radius, revision: 1))
    #expect(path.count > 2)                          // it turned somewhere
    #expect(path.first == a)
    #expect(path.last == b)

    let straight = distance(a, b) / PX_PER_METRE
    #expect(polylineMetres(path) > straight)

    // Every corner it turns at clears the building by the pedestrian's radius:
    // the graph's nodes sit on the radius + NODE_MARGIN ring, so no vertex may
    // land inside the wall itself.
    for p in path.dropFirst().dropLast() {
      #expect(!pointInPolygon(blocker.polygons[0], p))
    }
  }

  @Test("a building fully enclosing the destination has no route to it")
  func enclosed() {
    let graph = MeasuringGraph()
    let a = Point(0, 0)
    let b = Point(500, 500)
    // Four bars around b, overlapping at the corners so nothing slips through --
    // the same shape `borderFrame` builds, and for the same reason.
    let ring = Wall(id: 1, polygons: [
      [Point(300, 300), Point(700, 300), Point(700, 320), Point(300, 320)],
      [Point(300, 680), Point(700, 680), Point(700, 700), Point(300, 700)],
      [Point(300, 300), Point(320, 300), Point(320, 700), Point(300, 700)],
      [Point(680, 300), Point(700, 300), Point(700, 700), Point(680, 700)],
    ])
    #expect(graph.route(from: a, to: b, walls: [ring], radius: radius, revision: 1) == nil)
  }

  @Test("blocking a gap never shortens the walk")
  func monotone() throws {
    let graph = MeasuringGraph()
    let a = Point(0, 0), b = Point(1400, 0)

    let one = [wall(1, square(400, -300, 200))]
    let two = one + [wall(2, square(900, 100, 200))]

    let short = try #require(graph.route(from: a, to: b, walls: one, radius: radius, revision: 1))
    let long = try #require(graph.route(from: a, to: b, walls: two, radius: radius, revision: 2))
    #expect(polylineMetres(long) >= polylineMetres(short) - 1e-9)
  }

  @Test("a bigger pedestrian walks a wider berth")
  func radiusWidensThePath() throws {
    let graph = MeasuringGraph()
    let a = Point(0, 0), b = Point(1000, 0)
    let blocker = [wall(1, square(400, -200, 200))]

    let small = try #require(graph.route(from: a, to: b, walls: blocker, radius: 5, revision: 1))
    let large = try #require(graph.route(from: a, to: b, walls: blocker, radius: 30, revision: 1))
    // Same revision on purpose: the cache must notice the radius changed.
    #expect(polylineMetres(large) > polylineMetres(small))
  }

  @Test("the cache rebuilds when the walls change under the same radius")
  func cacheKeyedOnRevision() throws {
    let graph = MeasuringGraph()
    let a = Point(0, 0), b = Point(1000, 0)

    let open = try #require(graph.route(from: a, to: b, walls: [], radius: radius, revision: 1))
    #expect(open.count == 2)

    let blocked = try #require(graph.route(from: a, to: b, walls: [wall(1, square(400, -200, 200))],
                                           radius: radius, revision: 2))
    #expect(blocked.count > 2)
  }
}

/// The measurement must be a distance, not a congestion price.
///
/// `Navigation.recost` rewrites the live graph's edge weights with crowd-priced
/// traversal times every 120 ticks. Measuring off `world.nav` would inherit that
/// silently; `MeasuringGraph` builds its own, and this is the guard that says so.
@MainActor
@Suite("Measuring is independent of the crowd")
struct MeasureIsClearGroundTests {
  @Test("a busy map measures the same as an empty one")
  func crowdDoesNotMoveTheNumber() throws {
    let walls = [wall(1, square(400, -200, 200))]
    let a = Point(0, 0), b = Point(1000, 0)

    let quiet = MeasuringGraph()
    let quietPath = try #require(quiet.route(from: a, to: b, walls: walls,
                                             radius: radius, revision: 1))

    // A world with the same geometry, a goal, a crowd, and enough ticks for
    // recost to have run several times (RECOST_TICKS is 120).
    let world = WalkyWorld()
    world.viewport.width = 800
    world.viewport.height = 800
    world.addWalls([walls[0].polygons])
    _ = world.setGoalAt(Point(500, -100))
    for i in 0..<40 { world.addPedestrians(Point(60 + Double(i) * 12, 40)) }
    world.running = true
    for _ in 0..<400 { world.stepOnce() }

    let busy = MeasuringGraph()
    let busyPath = try #require(busy.route(from: a, to: b, walls: world.walls,
                                           radius: world.settings.pedestrianRadius,
                                           revision: world.worldRevision))
    #expect(polylineMetres(busyPath) == polylineMetres(quietPath))
  }
}

/// A tap is a finger on a map, not a survey point, so it lands on buildings.
@MainActor
@Suite("Measuring from a point inside a wall")
struct StandablePointTests {
  @Test("a point inside a building comes back just outside it")
  func nudgedOut() {
    let world = WalkyWorld()
    world.addWalls([[square(0, 0, 400)]])

    let inside = Point(100, 200)
    let out = world.standable(inside)

    #expect(out != inside)
    #expect(!pointInPolygon(world.walls[0].polygons[0], out))
    // Outside the *inflated* outline as well, which is the ring the graph's own
    // nodes sit on -- being merely outside the wall is not enough to route from.
    for ob in world.nav.obstacles { #expect(!pointInPolygon(ob.hull, out)) }
    // It left by the near edge: x moved, y did not.
    #expect(out.y == inside.y)
    #expect(out.x < 0)
  }

  @Test("a point on open ground is returned untouched")
  func openGroundUntouched() {
    let world = WalkyWorld()
    world.addWalls([[square(0, 0, 400)]])
    let clear = Point(2000, 2000)
    #expect(world.standable(clear) == clear)
  }

  @Test("measuring to a point on a wall answers rather than refuses")
  func measuresAnyway() {
    let world = WalkyWorld()
    world.addWalls([[square(400, 400, 200)]])

    // The second end is inside the building, which used to be "No way through
    // from there" -- the tool's literalism reported as the map's fault.
    world.measure(Point(0, 0), Point(500, 500))

    let m = world.measurement
    #expect(m != nil)
    #expect(m?.b != Point(500, 500))
    #expect(m?.walkyMetres ?? 0 > 0)
  }
}
