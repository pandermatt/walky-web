import Testing
import Foundation
import WalkySim
import WalkyGeo
@testable import WalkyCore

/// A scanned room, placed and walked -- the end of the feature rather than the
/// middle of it.
///
/// `RoomScanTests` proves the geometry; this proves a crowd can cross it, which
/// is a different question and the one that actually failed first: the sample
/// room converted perfectly and the crowd still could not get to the exit.
@MainActor
@Suite("A room the crowd can cross")
struct RoomWorldTests {
  /// The app's own placement, minus the UI: walls, furniture, an exit slab in
  /// the widest gap, and the goal on it. Mirrors `RoomScanner.place`.
  ///
  /// Only the wall-and-goal shape: the two walking tests build their own world
  /// so they can mark the goal last and await the rebuild. After the first
  /// build an edit only *schedules* one, so a test that steps synchronously
  /// runs against a graph with no goal field in it -- every agent skipped,
  /// standing still, which reads exactly like a routing bug and is not one.
  /// `RoomScanner.place` awaits `navReady()` for the same reason.
  private func placed(furniture: Bool = true) -> (WalkyWorld, RoomImport, Point) {
    let world = WalkyWorld()
    world.viewport.width = 390
    world.viewport.height = 844
    let plan = roomWalls(.sample, RoomOptions(includeFurniture: furniture))

    world.addWalls(plan.walls)
    if !plan.furniture.isEmpty {
      world.addWalls(plan.furniture, WallOptions(color: (120, 120, 130)))
    }
    let exit = plan.doorways.max { $0.metres < $1.metres }!
    for doorway in plan.doorways {
      // The narrower doorways are filled, as an entrance is: a room people
      // arrive into should not leak them back out.
      if doorway.at != exit.at {
        world.addWallShape([doorway.slab], WallOptions(color: (90, 90, 100)))
      }
    }
    world.addWallShape([exit.slab], WallOptions(color: (0, 200, 120)))
    world.setGoalAt(exit.at)
    return (world, plan, exit.at)
  }

  @Test("the exit slab is a wall, and marking it makes it the goal")
  func exitIsAGoal() {
    let (world, _, exit) = placed()
    let wall = world.pickWall(exit)
    #expect(wall != nil)
    #expect(wall?.isGoal == true)
    #expect(world.walls.filter(\.isGoal).count == 1)
  }

  @Test("somebody standing in the room walks to the exit and arrives")
  func crossesTheRoom() async {
    let world = WalkyWorld()
    world.viewport.width = 390
    world.viewport.height = 844
    let plan = roomWalls(.sample, RoomOptions())
    world.addWalls(plan.walls)
    world.addWalls(plan.furniture, WallOptions(color: (120, 120, 130)))

    // In the north-east corner, which is the far side of the table from the
    // exit -- the walk this room is for.
    let spots = world.pedestrianBlock(Point(60, -100), 1)
    #expect(!spots.isEmpty, "the north-east corner should be standable floor")
    world.addPedestrians(Point(60, -100))
    #expect(world.agents.count > 0)

    // Marked after the crowd is painted, because `Agents.add` gives a new
    // pedestrian no goal at all -- as the 2016 app does, and as the web app
    // still does. Painting first and aiming second is the order the tools are
    // used in.
    let exit = plan.doorways.max { $0.metres < $1.metres }!
    world.addWallShape([exit.slab], WallOptions(color: (0, 200, 120)))
    world.setGoalAt(exit.at)
    await world.navReady()

    world.running = true
    // 20 seconds of simulated time. A 5m room at 1.35m/s is four seconds of
    // walking, so this is generous even with a table in the way.
    for _ in 0..<(60 * 20) { world.stepOnce() }

    #expect(world.agents.allArrived,
            "still walking after 20s at (\(world.agents.x[0]), \(world.agents.y[0]))")
  }

  @Test("a door lets people in, and they leave by the exit")
  func doorFillsAndDrains() async {
    let world = WalkyWorld()
    world.viewport.width = 390
    world.viewport.height = 844
    let plan = roomWalls(.sample, RoomOptions())
    world.addWalls(plan.walls)
    world.addWalls(plan.furniture, WallOptions(color: (120, 120, 130)))

    let exit = plan.doorways.max { $0.metres < $1.metres }!
    let entrance = plan.doorways.min { $0.metres < $1.metres }!
    world.addWallShape([exit.slab], WallOptions(color: (0, 200, 120)))
    // The doorway *is* the generator: one wall, filling the gap, that people
    // come out of on the side its goal is on. An open gap would let the crowd walk
    // straight back out of the room it just entered.
    #expect(world.addGeneratorShape([entrance.slab]))

    // Last, so it aims the door as well as the crowd.
    world.setGoalAt(exit.at)
    await world.navReady()
    #expect((world.generators.first?.generator?.goal ?? -1) >= 0,
            "the generator should be aimed at the exit")

    world.running = true
    for _ in 0..<(60 * 30) { world.stepOnce() }

    // People arrived and were retired, so the room reaches a steady state
    // rather than filling up: 30s at four a second is 120 arrivals' worth.
    #expect(world.metrics.readout().throughputPerSecond > 0)
    #expect(world.agents.count < 60, "the room filled up: \(world.agents.count) inside")
  }
}
