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
  /// Lassos handed to `selectPedestriansIn`, and what each caught.
  var lassos: [[Point]] = []
  var lassoCatches = 1
  var selected = 0
  var measured: [(Point, Point)] = []

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
    selectPedestriansIn: { [unowned self] lasso in
      self.lassos.append(lasso); self.selected = self.lassoCatches; return self.lassoCatches },
    selectionCount: { [unowned self] in self.selected },
    clearSelection: { [unowned self] in self.selectionCleared += 1; self.selected = 0 },
    deactivateTool: { [unowned self] in self.deactivated += 1 },
    notify: { [unowned self] m in self.notices.append(m) },
    requestRender: {},
    colorAt: { _ in nil },
    worldPerPixel: { [unowned self] in self.perPixel },
    measure: { [unowned self] a, b in self.measured.append((a, b)) })
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
    // At the lift, not the touch: that is what leaves room to tell a tap from
    // the lasso drag, and it is where RectangleTool and BorderTool decide too.
    t.onPointerDown(down(Point(50, 50)), r.ctx)
    #expect(r.goalsAt.isEmpty)
    t.onPointerUp(up(Point(50, 50)), r.ctx)
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
    t.onPointerUp(up(Point(5, 5)), r.ctx)
    #expect(r.notices.count == 1)
    #expect(r.selectionCleared == 0)
    #expect(r.deactivated == 0)
  }

  @Test("a drag lassos instead of assigning, and keeps the tool")
  func dragLassos() {
    let r = Recorder(); let t = GoalTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    // A curved stroke enclosing real area, so `outline` uses it rather than
    // falling back to the bounding rectangle.
    for p in [Point(0, 40), Point(40, 60), Point(70, 30), Point(40, -10)] {
      t.onPointerMove(move(p), r.ctx)
    }
    t.onPointerUp(up(Point(0, 0)), r.ctx)
    #expect(r.lassos.count == 1)
    #expect(r.lassos[0].count >= 3)
    // Not a goal, and the tool stays in hand for the tap that follows.
    #expect(r.goalsAt.isEmpty)
    #expect(r.deactivated == 0)
    #expect(r.notices.isEmpty)
  }

  @Test("a lasso that catches nobody says so and stays armed")
  func emptyLasso() {
    let r = Recorder(); r.lassoCatches = 0
    let t = GoalTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(60, 60)), r.ctx)
    t.onPointerUp(up(Point(60, 60)), r.ctx)
    #expect(r.notices.count == 1)
    #expect(r.deactivated == 0)
  }

  @Test("a fast straight drag still selects, by falling back to a rectangle")
  func straightDragSelects() {
    // Three collinear points enclose no area at all. Without the fallback a
    // quick drag would select nobody, which just reads as the tool being broken.
    let r = Recorder(); let t = GoalTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(50, 50)), r.ctx)
    t.onPointerMove(move(Point(100, 100)), r.ctx)
    t.onPointerUp(up(Point(100, 100)), r.ctx)
    #expect(r.lassos.count == 1)
    #expect(r.lassos[0] == [Point(0, 0), Point(100, 0), Point(100, 100), Point(0, 100)])
  }

  @Test("the threshold is in screen points, so a zoomed-out drag is a tap")
  func thresholdScales() {
    // 6 world units is a drag at zoom 0 and well under a finger's width when
    // zoomed out -- the divergence DRAG_THRESHOLD's comment exists for.
    let r = Recorder(); r.perPixel = 8
    let t = GoalTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(6, 0)), r.ctx)
    t.onPointerUp(up(Point(6, 0)), r.ctx)
    #expect(r.lassos.isEmpty)
    #expect(r.goalsAt == [Point(6, 0)])
  }
}

@Suite("No hover on iOS")
@MainActor
struct HoverTests {
  /// The web keeps a cursor ghost after a gesture because a mouse really is
  /// still hovering there. A finger is not, so a ghost left at the last touch
  /// point sits on the map for the rest of the session -- which is exactly
  /// what happened, and is visible in the first freehand wall drawn on device.

  @Test("the wall tool's ghost does not outlive the touch")
  func wallGhost() {
    let r = Recorder(); let t = WallTool()
    t.onPointerDown(down(Point(10, 10)), r.ctx)
    // Under the 5pt drag threshold, so this is still a tap and the ghost shows.
    // Move further and the tool starts tracing, which hides the ghost anyway.
    t.onPointerMove(move(Point(13, 13)), r.ctx)
    #expect(t.preview().cursorGhost != nil)
    t.onPointerUp(up(Point(13, 13)), r.ctx)
    #expect(t.preview().cursorGhost == nil)
  }

  @Test("a traced stroke leaves no ghost behind either")
  func wallGhostAfterTrace() {
    let r = Recorder(); let t = WallTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    for i in stride(from: 0.0, through: 90.0, by: 5) { t.onPointerMove(move(Point(i, i)), r.ctx) }
    t.onPointerUp(up(Point(90, 90)), r.ctx)
    #expect(t.preview().cursorGhost == nil)
  }

  @Test("the brush's ghost dots clear on lift")
  func pedestrianGhost() {
    let r = Recorder(); let t = PedestrianTool()
    t.onPointerDown(down(Point(0, 0)), r.ctx)
    t.onPointerMove(move(Point(20, 0)), r.ctx)
    #expect(!t.preview().pendingPedestrians.isEmpty)
    t.onPointerUp(up(Point(20, 0)), r.ctx)
    #expect(t.preview().pendingPedestrians.isEmpty)
  }

  @Test("the goal tool's target lines clear on lift")
  func goalLines() {
    let r = Recorder(); r.goalHits = false
    let t = GoalTool()
    t.onPointerMove(move(Point(30, 30)), r.ctx)
    #expect(t.preview().targetLines != nil)
    t.onPointerUp(up(Point(30, 30)), r.ctx)
    #expect(t.preview().targetLines == nil)
  }

  @Test("the rectangle tool's ghost clears, and the first corner survives")
  func rectangleGhost() {
    let r = Recorder(); let t = RectangleTool()
    t.onPointerDown(down(Point(10, 10)), r.ctx)
    t.onPointerUp(up(Point(10, 10)), r.ctx)          // a tap: sets the first corner
    #expect(t.preview().cursorGhost == nil)
    #expect(t.preview().pendingRect == nil)
    // The corner is still held, so a second tap completes the rectangle.
    t.onPointerDown(down(Point(90, 70)), r.ctx)
    t.onPointerUp(up(Point(90, 70)), r.ctx)
    #expect(r.walls.count == 1)
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

@Suite("MeasureTool")
@MainActor
struct MeasureToolTests {
  @Test("two taps measure between them")
  func twoTaps() {
    let host = Recorder()
    let tool = MeasureTool()

    tool.onPointerDown(down(Point(10, 10)), host.ctx)
    tool.onPointerUp(up(Point(10, 10)), host.ctx)
    #expect(host.measured.isEmpty)          // one point is not a measurement

    tool.onPointerDown(down(Point(200, 10)), host.ctx)
    tool.onPointerUp(up(Point(200, 10)), host.ctx)
    #expect(host.measured.count == 1)
    #expect(host.measured[0].0 == Point(10, 10))
    #expect(host.measured[0].1 == Point(200, 10))
  }

  @Test("a drag measures its own two ends")
  func drag() {
    let host = Recorder()
    let tool = MeasureTool()

    tool.onPointerDown(down(Point(0, 0)), host.ctx)
    tool.onPointerMove(move(Point(300, 40)), host.ctx)
    tool.onPointerUp(up(Point(300, 40)), host.ctx)

    #expect(host.measured.count == 1)
    #expect(host.measured[0].0 == Point(0, 0))
    #expect(host.measured[0].1 == Point(300, 40))
  }

  @Test("tapping the same spot twice measures nothing")
  func degenerate() {
    let host = Recorder()
    let tool = MeasureTool()

    tool.onPointerDown(down(Point(50, 50)), host.ctx)
    tool.onPointerUp(up(Point(50, 50)), host.ctx)
    tool.onPointerDown(down(Point(50, 50)), host.ctx)
    tool.onPointerUp(up(Point(50, 50)), host.ctx)

    #expect(host.measured.isEmpty)
  }

  @Test("the first point is dropped when the tool is put away")
  func cancelForgets() {
    let host = Recorder()
    let tool = MeasureTool()

    tool.onPointerDown(down(Point(10, 10)), host.ctx)
    tool.onPointerUp(up(Point(10, 10)), host.ctx)
    tool.cancel()

    tool.onPointerDown(down(Point(200, 10)), host.ctx)
    tool.onPointerUp(up(Point(200, 10)), host.ctx)
    #expect(host.measured.isEmpty)          // that second tap is a new first tap
  }

  @Test("no ghost is left parked after the finger lifts")
  func noHover() {
    let host = Recorder()
    let tool = MeasureTool()

    tool.onPointerDown(down(Point(10, 10)), host.ctx)
    tool.onPointerMove(move(Point(12, 12)), host.ctx)
    tool.onPointerUp(up(Point(10, 10)), host.ctx)

    let p = tool.preview()
    #expect(p.cursorGhost == nil)
    #expect(p.pendingWallPoints == [Point(10, 10)])   // the placed point only
  }
}
