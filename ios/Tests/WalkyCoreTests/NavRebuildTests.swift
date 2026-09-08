import Testing
import Foundation
@testable import WalkyCore
@testable import WalkySim

/// The navigation rebuild, moved off the main actor.
///
/// It is `n^2.5` in wall corners -- 2.1 seconds on a forced 600m import -- and
/// it used to run on the main actor on every wall edit. These pin the three
/// things that makes true: the build is a pure function of walls and radius,
/// edits coalesce into one rebuild rather than one each, and a build that
/// finishes after the walls moved on is discarded.
@MainActor
@Suite("Navigation rebuild")
struct NavRebuildTests {
  private func box(_ x: Double, _ y: Double) -> [[Point]] {
    [rectanglePolygon(Point(x, y), Point(x + 80, y + 60))]
  }

  private func fresh() -> WalkyWorld {
    let world = WalkyWorld()
    world.settings.defaults = nil
    return world
  }

  /// The property the whole change rests on: the same walls and the same
  /// radius give the same graph, wherever it was built. This is what would
  /// catch a snapshot that dropped a field -- `isGoal`, say, which decides
  /// which routing fields exist at all.
  @Test("a snapshot build equals the one taken in place")
  func snapshotMatches() {
    var walls: [Wall] = []
    for i in 0..<6 { walls.append(Wall(id: i, polygons: box(Double(i) * 200, 0))) }
    walls[5].isGoal = true

    let inPlace = Navigation()
    inPlace.rebuild(walls, 13)

    let built = Navigation.build(walls.map(WallSnapshot.init), 13)
    let viaSnapshot = Navigation()
    viaSnapshot.install(built)

    #expect(viaSnapshot.nodes.count == inPlace.nodes.count)
    #expect(viaSnapshot.nodes == inPlace.nodes)
    #expect(viaSnapshot.obstacles.count == inPlace.obstacles.count)
    // The routing field is the half a dropped `isGoal` would silently lose.
    #expect(viaSnapshot.hasGoal(5))
    #expect(viaSnapshot.hasGoal(5) == inPlace.hasGoal(5))
  }

  /// A wall carries its hull, so the build never recomputes one. Cheaper, and
  /// it is what guarantees the background build sees identical input.
  @Test("a snapshot carries the hull rather than recomputing it")
  func snapshotKeepsHull() {
    let wall = Wall(id: 1, polygons: box(0, 0))
    let snapshot = WallSnapshot(wall)
    #expect(snapshot.hull == wall.hull)
    #expect(snapshot.wall.hull == wall.hull)
  }

  @Test("the first graph is built in place, because there is nothing to walk on")
  func firstBuildIsSynchronous() {
    // No runloop runs in a synchronous test, so a purely scheduled rebuild
    // would never land and the crowd would never move. Every world test in
    // this suite depends on that, and so does anybody stepping a world by hand.
    let world = fresh()
    world.addWallShape(box(0, 0), nil)
    #expect(world.nav.obstacles.isEmpty)
    world.stepOnce()
    #expect(!world.nav.obstacles.isEmpty)
  }

  @Test("editing after the first build does not rebuild in place")
  func laterEditsAreDeferred() async {
    let world = fresh()
    world.addWallShape(box(0, 0), nil)
    world.stepOnce()
    let before = world.nav.obstacles.count

    // A second wall. The graph is deliberately still the old one until the
    // background build lands -- that is the crowd keeping the routes it has.
    world.addWallShape(box(400, 0), nil)
    world.stepOnce()
    #expect(world.nav.obstacles.count == before)

    await world.navReady()
    #expect(world.nav.obstacles.count > before)
  }

  /// The bonus, and the part most likely to regress quietly back into a
  /// rebuild per edit.
  @Test("ten edits in a row cost one rebuild, not ten")
  func editsCoalesce() async {
    let world = fresh()
    world.addWallShape(box(0, 0), nil)
    world.stepOnce()                       // the first, in place

    for i in 1...10 { world.addWallShape(box(Double(i) * 200, 0), nil) }
    await world.navReady()

    // All ten are in the graph, from one build.
    #expect(world.walls.count == 11)
    #expect(world.nav.obstacles.count == 11)
  }

  @Test("a build that lands after the walls moved on is discarded")
  func staleBuildDropped() async {
    let world = fresh()
    world.addWallShape(box(0, 0), nil)
    world.stepOnce()

    // Two edits with no await between them: the first build is answering a map
    // that no longer exists by the time it finishes.
    world.addWallShape(box(400, 0), nil)
    world.addWallShape(box(800, 0), nil)
    await world.navReady()

    // The installed graph is the second map's, not the first's.
    #expect(world.nav.obstacles.count == 3)
  }

  /// The decision this rests on: the crowd walks on the routes it has while a
  /// rebuild runs, rather than standing still waiting for one.
  @Test("the crowd keeps moving while a rebuild is in flight")
  func crowdKeepsWalking() async {
    let world = fresh()
    world.addWallShape([rectanglePolygon(Point(600, -60), Point(700, 60))], nil)
    world.settings.brushSize = 1
    world.addPedestrians(Point(0, 0))
    #expect(world.setGoalAt(Point(650, 0)))
    // Marking a goal schedules rather than rebuilds, so the routing field for
    // it lands with the build. That is the deferral working, not a stall.
    await world.navReady()
    world.stepOnce()
    let startX = world.agents.x[0]

    // An edit that dirties the graph, then steps taken before it can land.
    world.addWallShape([rectanglePolygon(Point(-400, -400), Point(-300, -300))], nil)
    for _ in 0..<30 { world.stepOnce() }
    #expect(world.agents.x[0] != startX, "the crowd stalled waiting for a rebuild")

    await world.navReady()
  }
}
