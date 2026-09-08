import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// Lassoing a group, and the second goal it makes possible.
///
/// Driven against a real `WalkyWorld` rather than the `Recorder` fake in
/// `ToolTests`, because the feature *is* the interaction between three pieces
/// that a fake cannot show: the lasso writes `agents.selected`, `setGoalAt`
/// branches on `selectionCount`, and `pruneGoals` decides how many walls stay
/// flagged. Each is fine alone; only together do they add up to two goals.
@MainActor
@Suite("Selection")
struct SelectionTests {
  /// One wall at each end and a row of pedestrians between them, one per
  /// brush point so their positions are known.
  private func fresh() -> WalkyWorld {
    let world = WalkyWorld()
    world.settings.defaults = nil
    world.settings.brushSize = 1
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    world.addWallShape([rectanglePolygon(Point(900, 0), Point(1000, 100))], nil)
    for i in 0..<6 {
      world.addPedestrians(Point(300 + Double(i) * 60, 400))
    }
    return world
  }

  private func box(_ a: Point, _ b: Point) -> [Point] { rectanglePolygon(a, b) }

  @Test("a lasso selects who is inside it and nobody else")
  func selectsInside() {
    let world = fresh()
    let all = world.agents.count
    #expect(all >= 6)

    let caught = world.selectPedestriansIn(box(Point(280, 350), Point(500, 450)))
    #expect(caught > 0)
    #expect(caught < all)
    #expect(world.agents.selectionCount == caught)

    for i in 0..<world.agents.count {
      let inside = Double(world.agents.x[i]) >= 280 && Double(world.agents.x[i]) <= 500
      #expect((world.agents.selected[i] != 0) == inside)
    }
  }

  /// The shape is used as drawn. A hull would swallow the gap, which is the
  /// whole reason a lasso is worth having over a rectangle.
  @Test("a concave lasso excludes the notch it was drawn around")
  func concaveExcludes() {
    let world = fresh()
    // A wide band with a deep notch bitten out of its middle.
    let lasso = [Point(280, 350), Point(700, 350), Point(700, 450),
                 Point(520, 450), Point(520, 360), Point(460, 360),
                 Point(460, 450), Point(280, 450)]
    world.selectPedestriansIn(lasso)

    for i in 0..<world.agents.count {
      let x = Double(world.agents.x[i]), y = Double(world.agents.y[i])
      if x > 470 && x < 510 && y > 370 {
        #expect(world.agents.selected[i] == 0)
      }
    }
    #expect(world.agents.selectionCount > 0)
  }

  @Test("selecting again replaces rather than extends")
  func replaces() {
    let world = fresh()
    world.selectPedestriansIn(box(Point(280, 350), Point(400, 450)))
    let first = world.agents.selectionCount
    #expect(first > 0)

    world.selectPedestriansIn(box(Point(560, 350), Point(700, 450)))
    for i in 0..<world.agents.count where world.agents.selected[i] != 0 {
      #expect(Double(world.agents.x[i]) >= 560)
    }
  }

  /// The point of the whole change.
  @Test("two goals coexist, and the crowd splits between them")
  func twoGoals() {
    let world = fresh()

    world.selectPedestriansIn(box(Point(280, 350), Point(420, 450)))
    #expect(world.agents.selectionCount > 0)
    #expect(world.setGoalAt(Point(50, 50)))
    // Assigning consumes the selection, as `GoalTool` does through the context.
    world.clearSelection()

    world.selectPedestriansIn(box(Point(540, 350), Point(700, 450)))
    #expect(world.agents.selectionCount > 0)
    #expect(world.setGoalAt(Point(950, 50)))
    world.clearSelection()

    // Both walls stay flagged, because somebody is heading to each.
    #expect(world.walls[0].isGoal)
    #expect(world.walls[1].isGoal)

    let left = world.walls[0].id, right = world.walls[1].id
    var toLeft = 0, toRight = 0
    for i in 0..<world.agents.count {
      if Int(world.agents.goal[i]) == left { toLeft += 1 }
      if Int(world.agents.goal[i]) == right { toRight += 1 }
    }
    #expect(toLeft > 0)
    #expect(toRight > 0)
  }

  /// The behaviour `WorldTests.goalsPruned` pins, still true with selection in
  /// the picture: a goal is not free, so one nobody wants is dropped.
  @Test("a goal is still pruned once its group is retargeted")
  func prunesWhenEmptied() {
    let world = fresh()

    world.selectPedestriansIn(box(Point(280, 350), Point(420, 450)))
    #expect(world.setGoalAt(Point(50, 50)))
    world.clearSelection()
    #expect(world.walls[0].isGoal)

    // Everyone, this time: nobody is left heading for the first wall.
    #expect(world.setGoalAt(Point(950, 50)))
    #expect(world.walls[1].isGoal)
    #expect(world.walls[0].isGoal == false)
  }

  @Test("a lasso round empty ground catches nobody and clears what was picked")
  func emptyLasso() {
    let world = fresh()
    world.selectPedestriansIn(box(Point(280, 350), Point(420, 450)))
    #expect(world.agents.selectionCount > 0)

    #expect(world.selectPedestriansIn(box(Point(-900, -900), Point(-800, -800))) == 0)
    #expect(world.agents.selectionCount == 0)
  }

  /// The whole path, from a finger to a selection.
  ///
  /// Worth its own test because the pieces each pass alone and the gesture is
  /// where they meet: `PointerRouter` withholds the press until the first move,
  /// `GoalTool` latches `dragging` during that move, and only `onPointerUp`
  /// commits. A drag that never reaches the tool looks exactly like a lasso
  /// that caught nobody, and the first simulator run of this feature was read
  /// as the second when it was really neither.
  @Test("a drag routed through PointerRouter arrives as a lasso")
  func routedDrag() {
    let world = fresh()
    world.setTool(.goal)
    let router = PointerRouter(host: world)
    let id = TouchId(1)
    func screen(_ w: Point) -> Point { world.viewport.worldToScreen(w) }

    router.began(id, at: screen(Point(280, 350)))
    for t in stride(from: 0.0, through: 1.0, by: 0.1) {
      router.moved(id, to: screen(Point(280 + 220 * t, 350 + 100 * t)))
    }
    router.ended(id, at: screen(Point(500, 450)))

    #expect(world.agents.selectionCount > 0)
    // A lasso, not a goal: the tool is still in hand for the tap that follows.
    #expect(world.walls.allSatisfy { !$0.isGoal })
    #expect(world.tool?.id == .goal)
  }

  /// The regression the tap-versus-drag split could break: with the goal tool
  /// armed, a press and release in one place must still assign to everyone.
  @Test("a routed tap on a wall still sends the whole crowd")
  func routedTap() {
    let world = fresh()
    world.setTool(.goal)
    let router = PointerRouter(host: world)
    let id = TouchId(1)
    let at = world.viewport.worldToScreen(Point(50, 50))

    router.began(id, at: at)
    router.ended(id, at: at)

    #expect(world.walls[0].isGoal)
    for i in 0..<world.agents.count { #expect(Int(world.agents.goal[i]) == world.walls[0].id) }
    // Assigning steps off the tool, so the next tap cannot reassign by accident.
    #expect(world.tool == nil)
  }

  /// Free, because `AgentsSnapshot` already carries `selected` -- but only
  /// while it keeps doing so, which is what this asserts.
  @Test("undo brings the selection back with the crowd")
  func undoRestoresSelection() {
    let world = fresh()
    world.selectPedestriansIn(box(Point(280, 350), Point(420, 450)))
    let picked = world.agents.selectionCount
    #expect(picked > 0)

    // `setGoalAt` checkpoints, so undo steps back over the assignment.
    #expect(world.setGoalAt(Point(50, 50)))
    world.clearSelection()
    #expect(world.agents.selectionCount == 0)

    world.undo()
    #expect(world.agents.selectionCount == picked)
    #expect(world.walls[0].isGoal == false)
  }
}
