import Testing
import Foundation
@testable import WalkyCore
@testable import WalkySim

/// Doors that let people out.
///
/// The arithmetic behind them was ported with the rest of the simulation and
/// sat unused: `Arrivals.swift` turns a door's position and its beat into a
/// clump size and a gap, hashed so the same door replays the same demand.
///
/// A generator **is a wall** here, unlike in the web app: any block can be
/// marked as one, exactly as any block can be marked a goal, it blocks the
/// crowd like the wall it is, and people come out of it on the side its goal is
/// on rather than standing in it. So most of what these tests ask about is a
/// wall with a `Generator` on it, and the one genuinely new question -- which
/// side do people appear on -- is `emitsOnTheGoalSide` below.
@MainActor
@Suite("Generators")
struct GeneratorTests {
  private func fresh() -> WalkyWorld {
    let world = WalkyWorld()
    world.settings.defaults = nil
    world.addWallShape([rectanglePolygon(Point(600, -80), Point(700, 80))], nil)
    return world
  }

  /// A block, marked. Two steps now rather than one, and that is the feature:
  /// there is no generator-shaped thing to place, only blocks you already drew
  /// and a tap that says what one of them is.
  @discardableResult
  private func mark(_ world: WalkyWorld, at: Point, half: Double = 39) -> Bool {
    world.addWallShape([rectanglePolygon(Point(at.x - half, at.y - half),
                                         Point(at.x + half, at.y + half))], nil)
    return world.toggleGeneratorAt(at)
  }

  @Test("a door with no goal lets nobody out")
  func unpinnedIsIdle() {
    // It has nowhere to send anybody, and since its people only leave the map
    // by arriving, what it would make is a pile that never goes away.
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    for _ in 0..<600 { world.stepOnce() }
    #expect(world.agents.count == 0)
  }

  @Test("a door pinned to a goal fills the map")
  func pinnedEmits() async {
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()

    for _ in 0..<600 { world.stepOnce() }
    #expect(world.agents.count > 0, "the door never opened")
    // And they are going somewhere: everybody it made wears the goal.
    let goalId = try! #require(world.walls.first { $0.isGoal }).id
    for i in 0..<world.agents.count {
      #expect(Int(world.agents.goal[i]) == goalId)
    }
  }

  /// The reason the goal tool aims at doors at all: pinning a pedestrian sends
  /// one person, pinning a door sends everybody it will ever let out.
  @Test("marking a goal aims the doors as well as the crowd")
  func goalAimsDoors() {
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.generators[0].generator!.goal == -1)
    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.generators[0].generator!.goal == world.walls[0].id)  // the goal wall was placed first
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
    #expect(mark(world, at: Point(0, 0)))
    #expect(mark(world, at: Point(300, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.agents.count == 0)

    // Aim the second door at the other wall. Nobody is on the map at all, so
    // the first wall stays a goal only because a door still wants it.
    #expect(world.selectPedestriansIn(rectanglePolygon(Point(200, -100), Point(400, 100))) == 1)
    #expect(world.setGoalAt(Point(-650, 0)))
    #expect(world.walls[1].isGoal)
    #expect(world.walls[0].isGoal, "the door's goal was pruned out from under it")
  }

  @Test("a tap on bare ground marks nothing")
  func missesEmptyGround() {
    // The goal tool's own answer to the same gesture, and the reason the tool
    // stays armed after one: there is nothing there to be a generator.
    let world = fresh()
    #expect(!world.toggleGeneratorAt(Point(-500, -500)))
    #expect(world.generators.isEmpty)
  }

  @Test("tapping a generator again turns it back into a plain block")
  func toggles() {
    // Without this, undo is the only way out of a mistap -- and the tap that
    // made it is the same tap that should take it back.
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.generators.count == 1)
    #expect(world.toggleGeneratorAt(Point(0, 0)))
    #expect(world.generators.isEmpty)
    #expect(world.walls.count == 2, "the block itself should still be there")
  }

  @Test("marking a block on a map that already has a goal aims it there")
  func inheritsTheGoal() {
    // One tap is enough on a map with a goal on it. Otherwise the first thing
    // every new generator would need is a trip to the goal tool.
    let world = fresh()
    #expect(world.setGoalAt(Point(650, 0)))
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.generators[0].generator!.goal == world.walls[0].id)
  }

  /// The one thing a generator being a wall makes somebody decide: nobody can
  /// stand *in* a wall, so which side do they come out of?
  @Test("people come out on the side the goal is on")
  func emitsOnTheGoalSide() async {
    let world = fresh()                       // the goal wall is east, at x 600
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()

    for _ in 0..<120 { world.stepOnce() }
    #expect(world.agents.count > 0, "the door never opened")
    // Every one of them appeared east of the door's own middle, which is the
    // way its goal lies -- and none inside it.
    let source = world.generators[0]
    for i in 0..<world.agents.count {
      #expect(Double(world.agents.x[i]) > 0, "somebody came out of the far side")
      #expect(!wallContains(source, Point(Double(world.agents.x[i]),
                                        Double(world.agents.y[i]))),
              "somebody is standing inside the generator")
    }
  }

  @Test("a generator blocks the crowd, because it is a wall")
  func doorsBlock() async {
    // The whole reason for the rewrite: a generator is part of the map rather
    // than a decal on it. Asked directly -- can anybody be in it, and does
    // navigation know about it -- rather than by walking somebody past it,
    // which would be a test about congestion wearing a test about geometry.
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    await world.navReady()
    let door = world.generators[0]

    // The brush cannot put anybody inside it, at any size.
    #expect(world.pedestrianBlock(Point(0, 0), 1).isEmpty)
    #expect(world.pedestrianBlock(Point(0, 0), 3).isEmpty)
    // And the visibility graph carries it, so the crowd routes around it and
    // `Behaviour.insideAnyWall` refuses to step into it.
    #expect(world.nav.obstacles.contains { $0.wallId == door.id })
  }

  /// Reset means the same demand again, not merely an empty queue: `Arrivals`
  /// is a hash of the beat, so replaying needs the beat put back.
  @Test("reset puts every door back to the top of its schedule")
  func resetRewindsSchedules() async {
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()
    for _ in 0..<300 { world.stepOnce() }
    #expect(world.generators[0].generator!.beat > 0)

    world.resetPedestrians()
    #expect(world.generators[0].generator!.beat == 0)
    #expect(world.generators[0].generator!.owed == 0)
    #expect(world.generators[0].generator!.wait == 0)
  }

  @Test("the same door replays the same demand")
  func demandIsDeterministic() async {
    func run() async -> Int {
      let world = fresh()
      mark(world, at: Point(0, 0))
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
    #expect(mark(world, at: Point(0, 0)))
    #expect(mark(world, at: Point(300, 0)))

    #expect(world.selectPedestriansIn(rectanglePolygon(Point(-100, -100), Point(100, 100))) == 1)
    #expect(world.generators[0].selected)
    #expect(!world.generators[1].selected)

    #expect(world.setGoalAt(Point(650, 0)))
    #expect(world.generators[0].generator!.goal == world.walls[0].id)
    #expect(world.generators[1].generator!.goal == -1, "the goal reached a door nobody picked")
  }

  @Test("undo takes a door back with it")
  func undoRemovesDoors() {
    let world = fresh()
    #expect(mark(world, at: Point(0, 0)))
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
    #expect(mark(world, at: Point(0, 0)))
    #expect(world.setGoalAt(Point(650, 0)))
    await world.navReady()
    for _ in 0..<600 { world.stepOnce() }
    #expect(world.generators[0].generator!.owed <= QUEUE_MAX)
  }
}
