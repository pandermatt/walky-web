import Testing
import Foundation
@testable import WalkyCore
@testable import WalkySim

/// Doors that let people out.
///
/// The arithmetic behind them was ported with the rest of the simulation and
/// sat unused: `Arrivals.swift` turns a door's position and its beat into a
/// clump size and a gap, hashed so the same door replays the same demand. What
/// is new is the thing that owns a schedule, a queue, and a place to stand.
@MainActor
@Suite("Generators")
struct GeneratorTests {
  private func fresh() -> WalkyWorld {
    let world = WalkyWorld()
    world.settings.defaults = nil
    world.addWallShape([rectanglePolygon(Point(600, -80), Point(700, 80))], nil)
    return world
  }

  @Test("a door with no goal lets nobody out")
  func unpinnedIsIdle() {
    // It has nowhere to send anybody, and since its people only leave the map
    // by arriving, what it would make is a pile that never goes away.
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    for _ in 0..<600 { world.stepOnce() }
    #expect(world.agents.count == 0)
  }

  @Test("a door pinned to a goal fills the map")
  func pinnedEmits() async {
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()

    for _ in 0..<600 { world.stepOnce() }
    #expect(world.agents.count > 0, "the door never opened")
    // And they are going somewhere: everybody it made wears the goal.
    for i in 0..<world.agents.count {
      #expect(Int(world.agents.goal[i]) == world.walls[0].id)
    }
  }

  /// The reason the goal tool aims at doors at all: pinning a pedestrian sends
  /// one person, pinning a door sends everybody it will ever let out.
  @Test("marking a goal aims the doors as well as the crowd")
  func goalAimsDoors() {
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.generators[0].goal == -1)
    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.generators[0].goal == world.walls[0].id)
    #expect(world.generators[0].color == world.walls[0].color)
  }

  /// A goal wall is kept marked only while somebody is heading there. A door
  /// counts as somebody, or its goal would be un-marked the moment the last of
  /// its people arrived and the door would be left aiming at nothing.
  @Test("a door keeps its goal marked with nobody on the map")
  func doorHoldsItsGoal() {
    // Two doors, so the second goal can be given to one of them and leave the
    // other still wanting the first. With nothing selected a goal re-aims
    // *everything* -- doors included -- which is why this picks one.
    let world = fresh()
    world.addWallShape([rectanglePolygon(Point(-700, -80), Point(-600, 80))], nil)
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.addGenerator(Point(300, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.agents.count == 0)

    // Aim the second door at the other wall. Nobody is on the map at all, so
    // the first wall stays a goal only because a door still wants it.
    #expect(world.selectPedestriansIn(rectanglePolygon(Point(200, -100), Point(400, 100))) == 1)
    #expect(world.setGoalAt(Point(-650, 0)))
    #expect(world.walls[1].isGoal)
    #expect(world.walls[0].isGoal, "the door's goal was pruned out from under it")
  }

  @Test("a door needs room to let anybody out")
  func refusedInsideAWall() {
    let world = fresh()
    // Squarely inside the goal wall.
    #expect(!world.addGenerator(Point(650, 0)))
    #expect(world.generators.isEmpty)
  }

  /// Reset means the same demand again, not merely an empty queue: `Arrivals`
  /// is a hash of the beat, so replaying needs the beat put back.
  @Test("reset puts every door back to the top of its schedule")
  func resetRewindsSchedules() async {
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()
    for _ in 0..<300 { world.stepOnce() }
    #expect(world.generators[0].beat > 0)

    world.resetPedestrians()
    #expect(world.generators[0].beat == 0)
    #expect(world.generators[0].owed == 0)
    #expect(world.generators[0].wait == 0)
  }

  @Test("the same door replays the same demand")
  func demandIsDeterministic() async {
    func run() async -> Int {
      let world = fresh()
      _ = world.addGenerator(Point(0, 0))
      _ = world.setGoalAt(Point(650, 0))
      await world.navReady()
      for _ in 0..<400 { world.stepOnce() }
      return world.agents.count
    }
    let a = await run()
    let b = await run()
    #expect(a == b)
    #expect(a > 0)
  }

  @Test("a lasso catches a door, and a goal then applies to it alone")
  func lassoPicksDoors() {
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.addGenerator(Point(300, 0)))

    #expect(world.selectPedestriansIn(rectanglePolygon(Point(-100, -100), Point(100, 100))) == 1)
    #expect(world.generators[0].selected)
    #expect(!world.generators[1].selected)

    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.generators[0].goal == world.walls[0].id)
    #expect(world.generators[1].goal == -1, "the goal reached a door nobody picked")
  }

  @Test("undo takes a door back with it")
  func undoRemovesDoors() {
    let world = fresh()
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.generators.count == 1)
    world.undo()
    #expect(world.generators.isEmpty)
  }

  /// The queue is what makes a burst look like a burst: a clump lands whole and
  /// leaves at whatever rate the doorway can pass. Without a ceiling it would
  /// grow for as long as a jam lasts and then empty into the first gap.
  @Test("the queue behind a blocked door is capped")
  func queueIsCapped() async {
    let world = fresh()
    world.settings.generatorRate = 20
    #expect(world.addGenerator(Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()
    for _ in 0..<600 { world.stepOnce() }
    #expect(world.generators[0].owed <= QUEUE_MAX)
  }
}
