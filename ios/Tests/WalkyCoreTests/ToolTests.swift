import Testing
import Foundation
@testable import WalkyCore

/// Stubbed context: the tools are driven with no world, no view and no simulator.
@MainActor
private final class Recorder {
  var walls: [[[Point]]] = []
  var options: [WallOptions?] = []
  var pedestriansAt: [Point] = []
  var goalsAt: [Point] = []
  var notices: [String] = []
  var deactivated = 0
  var selectionCleared = 0
  var goalHits = true
  var perPixel: Double = 1

  lazy var ctx: ToolContext = ToolContext(
    addWall: { [unowned self] polygon, o in
      self.walls.append([polygon]); self.options.append(o); return true },
    addWallShape: { [unowned self] polygons, o in
      self.walls.append(polygons); self.options.append(o); return true },
    settings: { SettingsSnapshot(pedestrianRadius: 13, personalSpace: 40,
                                 brushSize: 1, borderThickness: 12) },
    pedestrianBlock: { at, _ in [at] },
    addPedestrians: { [unowned self] at in self.pedestriansAt.append(at) },
    setGoalAt: { [unowned self] at in self.goalsAt.append(at); return self.goalHits },
    clearSelection: { [unowned self] in self.selectionCleared += 1 },
    deactivateTool: { [unowned self] in self.deactivated += 1 },
    notify: { [unowned self] m in self.notices.append(m) },
    requestRender: {},
    colorAt: { _ in nil },
    worldPerPixel: { [unowned self] in self.perPixel })
}

private func down(_ p: Point) -> PointerInfo { .down(world: p, screen: p) }
private func up(_ p: Point) -> PointerInfo { .up(world: p, screen: p) }
private func move(_ p: Point) -> PointerInfo { .down(world: p, screen: p) }

@Suite("RectangleTool")
@MainActor
struct RectangleToolTests {
  @Test("a drag past the threshold commits from press to release")
  func dragCommits() {
    let r = Recorder(); let t = RectangleTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerUp(up(Point(100, 80)), r.ctx)
    #expect(r.walls.count == 1)
    #expect(r.walls[0][0] == rectanglePolygon(Point(0, 0), Point(100, 80)))
  }

  @Test("a press and release in place sets one corner and commits nothing")
  func tapSetsCorner() {
    let r = Recorder(); let t = RectangleTool()
    t.onPointerDown(down(Point(10, 10)), r.ctx)
    t.onPointerUp(up(Point(11, 11)), r.ctx)
    #expect(r.walls.isEmpty)
    // A second tap elsewhere completes it.
    t.onPointerDown(down(Point(90, 70)), r.ctx)
    t.onPointerUp(up(Point(90, 70)), r.ctx)
    #expect(r.walls.count == 1)
  }

  @Test("the drag threshold is measured in points, not world units")
  func thresholdIsInPoints() {
    // The deliberate divergence: rectangleTool.ts:42 compares DRAG_THRESHOLD
    // against a world-space distance, so zoomed out every tap became a drag and
    // two-tap mode was unreachable. Here it scales with worldPerPixel.
    let r = Recorder()
    r.perPixel = 10          // zoomed out: one point is ten world units
    let t = RectangleTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    // 20 world units is 2 points of finger travel -- a tap, not a drag.
    t.onPointerUp(up(Point(20, 0)), r.ctx)
    #expect(r.walls.isEmpty, "20 world units at 10 units/pt is a 2pt tap")

    // The web app would have committed a wall here, because 20 >= 6.
    let sameAtZoomOne = Recorder()
    let t2 = RectangleTool()
    t2.onPointerDown(down(Point(0, 0)), sameAtZoomOne.ctx)
    t2.onPointerUp(up(Point(20, 20)), sameAtZoomOne.ctx)
    #expect(sameAtZoomOne.walls.count == 1)
  }

  @Test("a press with no primary button does nothing")
  func ignoresNonPrimary() {
    let r = Recorder(); let t = RectangleTool()
    t.onPointerDown(up(Point(0, 0)), r.ctx)      // buttons == 0
    t.onPointerUp(up(Point(100, 80)), r.ctx)
    #expect(r.walls.isEmpty)
  }

  @Test("a degenerate rectangle is refused")
  func refusesDegenerate() {
    let r = Recorder(); let t = RectangleTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerUp(up(Point(50, 0)), r.ctx)       // no height
    #expect(r.walls.isEmpty)
  }
}

@Suite("BorderTool")
@MainActor
struct BorderToolTests {
  @Test("commits four bars as one wall, flagged as a border")
  func fourBarsOneWall() {
    let r = Recorder(); let t = BorderTool()
    t.onPointerDown(down(Point(-400, -400)), r.ctx)
    t.onPointerUp(up(Point(400, 400)), r.ctx)
    #expect(r.walls.count == 1)
    #expect(r.walls[0].count == 4)
    #expect(r.options[0]?.isBorder == true)
  }

  @Test("refuses a frame with no usable interior, and says so in the preview")
  func refusesTooSmall() {
    let r = Recorder(); let t = BorderTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(30, 30)), r.ctx)
    // thickness 12 + radius 13 on every side leaves nothing to stand in.
    #expect(t.preview().pendingPolygonsInvalid)
    t.onPointerUp(up(Point(30, 30)), r.ctx)
    #expect(r.walls.isEmpty)
  }
}

@Suite("PedestrianTool")
@MainActor
struct PedestrianToolTests {
  @Test("a tap paints, and a drag keeps painting")
  func paints() {
    let r = Recorder(); let t = PedestrianTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(30, 0)), r.ctx)
    t.onPointerMove(move(Point(60, 0)), r.ctx)
    t.onPointerUp(up(Point(60, 0)), r.ctx)
    #expect(r.pedestriansAt == [Point(0, 0), Point(30, 0), Point(60, 0)])
  }

  @Test("moving without a press paints nothing but still previews")
  func hoverDoesNotPaint() {
    let r = Recorder(); let t = PedestrianTool()
    t.onPointerMove(move(Point(10, 10)), r.ctx)
    #expect(r.pedestriansAt.isEmpty)
    #expect(t.preview().pendingPedestrians == [Point(10, 10)])
  }
}

@Suite("GoalTool")
@MainActor
struct GoalToolTests {
  @Test("a hit clears the selection and steps off the tool")
  func hitCompletes() {
    let r = Recorder(); let t = GoalTool()
    t.onPointerDown(down(Point(50, 50)), r.ctx)
    #expect(r.goalsAt == [Point(50, 50)])
    #expect(r.selectionCleared == 1)
    #expect(r.deactivated == 1)
  }

  @Test("a miss says so and leaves the tool and selection alone")
  func missIsAMiss() {
    // Clearing up after a miss would mean lassoing the same group again to
    // have another go.
    let r = Recorder(); r.goalHits = false
    let t = GoalTool()
    t.onPointerDown(down(Point(5, 5)), r.ctx)
    #expect(r.notices.count == 1)
    #expect(r.selectionCleared == 0)
    #expect(r.deactivated == 0)
  }
}

@Suite("WallTool")
@MainActor
struct WallToolTests {
  @Test("a traced stroke is simplified before it becomes a wall")
  func traceSimplifies() {
    let r = Recorder(); let t = WallTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    // A dense trace round a triangle: one sample every few units, as a finger
    // would give.
    for i in stride(from: 0.0, through: 120.0, by: 4) { t.onPointerMove(move(Point(i, 0)), r.ctx) }
    for i in stride(from: 0.0, through: 120.0, by: 4) { t.onPointerMove(move(Point(120, i)), r.ctx) }
    for i in stride(from: 0.0, through: 120.0, by: 4) { t.onPointerMove(move(Point(120 - i, 120 - i)), r.ctx) }
    t.onPointerUp(up(Point(0, 0)), r.ctx)

    #expect(r.walls.count == 1)
    // Vertex count is what the whole navigation pipeline costs scale on, so a
    // ~90-sample trace must not become a 90-vertex polygon.
    #expect(r.walls[0][0].count < 12)
    #expect(r.walls[0][0].count >= 3)
  }

  @Test("tapped vertices close on a double tap")
  func tapMode() {
    let r = Recorder(); let t = WallTool()
    for p in [Point(0, 0), Point(100, 0), Point(100, 100)] {
      t.onPointerDown(down(p), r.ctx)
      t.onPointerUp(up(p), r.ctx)
    }
    #expect(r.walls.isEmpty)          // still open
    t.onDoubleTap(down(Point(0, 100)), r.ctx)
    #expect(r.walls.count == 1)
    #expect(r.walls[0][0].count == 4)
  }

  @Test("vertices closer than the minimum are ignored")
  func minimumSpacing() {
    let r = Recorder(); let t = WallTool()
    for p in [Point(0, 0), Point(3, 0), Point(5, 0)] {
      t.onPointerDown(down(p), r.ctx)
      t.onPointerUp(up(p), r.ctx)
    }
    // All within MINIMUM_DISTANCE of each other: one vertex, so no polygon.
    t.onDoubleTap(down(Point(6, 0)), r.ctx)
    #expect(r.walls.isEmpty)
  }

  @Test("cancel abandons a half-drawn shape")
  func cancelAbandons() {
    let r = Recorder(); let t = WallTool()
    for p in [Point(0, 0), Point(100, 0), Point(100, 100)] {
      t.onPointerDown(down(p), r.ctx)
      t.onPointerUp(up(p), r.ctx)
    }
    t.cancel()
    #expect(t.preview().pendingWallPoints.isEmpty)
    t.onDoubleTap(down(Point(0, 100)), r.ctx)
    #expect(r.walls.isEmpty)
  }
}
