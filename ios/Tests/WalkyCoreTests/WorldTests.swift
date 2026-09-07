import Testing
import Foundation
@testable import WalkyCore

@Suite("Undo")
@MainActor
struct UndoTests {

  @Test("a wall marked as a goal is un-marked by undo")
  func goalReverts() {
    // The trap this suite exists for. `Wall` is a class, so the obvious
    // `walls.map { $0 }` copies nothing: the snapshot would hold the same
    // objects, `hit.isGoal = true` would be visible through it, and undo would
    // appear to work while doing nothing at all.
    let world = WalkyWorld()
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    let wall = world.walls[0]
    #expect(wall.isGoal == false)

    #expect(world.setGoalAt(Point(50, 50)))
    #expect(world.walls[0].isGoal)

    world.undo()
    #expect(world.walls[0].isGoal == false)
  }

  @Test("the snapshot shares geometry rather than copying it")
  func geometryShared() {
    let world = WalkyWorld()
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    let before = world.walls[0]
    let copy = before.shallowCopy()

    // Same values, and the hull was not recomputed -- it was carried over.
    #expect(copy.polygons == before.polygons)
    #expect(copy.hull == before.hull)
    // But a flag written on one does not reach the other. That is the whole
    // contract: flags copied, geometry shared.
    copy.isGoal = true
    #expect(before.isGoal == false)
  }

  @Test("a wall drawn is a wall undone")
  func wallReverts() {
    let world = WalkyWorld()
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    world.addWallShape([rectanglePolygon(Point(200, 0), Point(300, 100))], nil)
    #expect(world.walls.count == 2)
    world.undo()
    #expect(world.walls.count == 1)
    world.undo()
    #expect(world.walls.isEmpty)
  }

  @Test("the crowd goes back to where it stood when the edit was made")
  func crowdReverts() {
    let world = WalkyWorld()
    world.addPedestrians(Point(0, 0))
    let n = world.agents.count
    #expect(n > 0)
    world.addPedestrians(Point(200, 0))
    #expect(world.agents.count > n)
    world.undo()
    #expect(world.agents.count == n)
  }

  @Test("the stack is a window on the recent past, not a limit on drawing")
  func depthWindow() {
    let world = WalkyWorld()
    // One more than the depth: the oldest is dropped, not the newest refused.
    for i in 0...UNDO_DEPTH {
      world.addWallShape([rectanglePolygon(Point(Double(i) * 200, 0),
                                           Point(Double(i) * 200 + 100, 100))], nil)
    }
    #expect(world.walls.count == UNDO_DEPTH + 1)
    var undone = 0
    while world.canUndo { world.undo(); undone += 1 }
    #expect(undone == UNDO_DEPTH)
    // The very first wall is beyond the window, so it survives.
    #expect(world.walls.count == 1)
  }

  @Test("an edit that changes nothing takes no checkpoint")
  func noEmptyCheckpoint() {
    // An undo step that undoes nothing is worse than none -- it is a press that
    // appears to do nothing at all.
    let world = WalkyWorld()
    #expect(!world.canUndo)
    // Fewer than three points is not a polygon.
    #expect(world.addWallShape([[Point(0, 0), Point(1, 1)]], nil) == false)
    #expect(!world.canUndo)
    // A goal tap on empty ground hits no wall.
    #expect(world.setGoalAt(Point(500, 500)) == false)
    #expect(!world.canUndo)
  }

  @Test("undo recomputes temperament from the origin rather than storing it")
  func temperamentSurvives() {
    let world = WalkyWorld()
    world.addPedestrians(Point(0, 0))
    let traits = (0..<world.agents.count).map { world.agents.trait[$0] }
    let parties = (0..<world.agents.count).map { world.agents.party[$0] }

    world.addWallShape([rectanglePolygon(Point(500, 500), Point(600, 600))], nil)
    world.undo()

    // Restored identically without ever being in the snapshot: `restore`
    // recomputes them from the origins, which is what stops undo quietly
    // reshuffling who is patient and who is with whom.
    #expect((0..<world.agents.count).map { world.agents.trait[$0] } == traits)
    #expect((0..<world.agents.count).map { world.agents.party[$0] } == parties)
  }
}

@Suite("World edits")
@MainActor
struct WorldEditTests {

  @Test("a wall drawn over a crowd takes those pedestrians with it")
  func wallRemovesAgents() {
    let world = WalkyWorld()
    world.addPedestrians(Point(0, 0))
    #expect(world.agents.count > 0)
    world.addWallShape([rectanglePolygon(Point(-100, -100), Point(100, 100))], nil)
    #expect(world.agents.count == 0)
  }

  @Test("the brush refuses a spot inside a wall")
  func brushRespectsWalls() {
    let world = WalkyWorld()
    world.addWallShape([rectanglePolygon(Point(-100, -100), Point(100, 100))], nil)
    #expect(world.pedestrianBlock(Point(0, 0), nil).isEmpty)
    #expect(!world.pedestrianBlock(Point(400, 400), nil).isEmpty)
  }

  @Test("the brush refuses a spot already occupied")
  func brushRespectsCrowd() {
    let world = WalkyWorld()
    world.addPedestrians(Point(0, 0))
    // The same spot again yields nothing, so a second tap adds nobody.
    #expect(world.pedestrianBlock(Point(0, 0), nil).isEmpty)
  }

  @Test("a block never places two pedestrians closer than a body apart")
  func brushSpacing() {
    let world = WalkyWorld()
    world.settings.brushSize = 4
    let spots = world.pedestrianBlock(Point(0, 0), nil)
    #expect(spots.count > 1)
    let minGap = 2 * world.settings.pedestrianRadius
    for i in 0..<spots.count {
      for j in (i + 1)..<spots.count {
        #expect(jsHypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= minGap)
      }
    }
  }

  @Test("reset-zoom frames what is drawn, wherever it was drawn")
  func resetZoomFrames() {
    let world = WalkyWorld()
    world.viewport.width = 400
    world.viewport.height = 300
    world.addWallShape([rectanglePolygon(Point(900, 400), Point(1000, 500))], nil)
    world.resetZoom()
    #expect(world.viewport.targetX == 950)
    #expect(world.viewport.targetY == 450)
  }

  @Test("a goal is pruned once nobody is walking to it")
  func goalsPruned() {
    // A goal is not free: Navigation runs a Dijkstra per goal wall per rebuild.
    let world = WalkyWorld()
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    world.addWallShape([rectanglePolygon(Point(400, 0), Point(500, 100))], nil)
    world.addPedestrians(Point(200, 300))

    #expect(world.setGoalAt(Point(50, 50)))
    #expect(world.walls[0].isGoal)

    // Aim the same crowd at the other wall: the first is no longer wanted.
    #expect(world.setGoalAt(Point(450, 50)))
    #expect(world.walls[1].isGoal)
    #expect(world.walls[0].isGoal == false)
  }
}
