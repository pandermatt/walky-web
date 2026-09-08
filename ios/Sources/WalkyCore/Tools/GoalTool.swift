import Foundation

/// Picks who is going, then marks a wall as their goal. From
/// `controller/MarkGoalToolMouseListener`, and ports `src/tools/goalTool.ts`
/// with `src/tools/selectionTool.ts` folded into it.
///
/// **Two steps, one tool, no second toolbar cell.** Drag to lasso a group; tap
/// a wall to send the current selection there, or everyone when nothing is
/// selected. The bar is seven 44pt cells in about 370pt of a 402pt screen, so a
/// sixth tool would not fit -- and it does not need to, because a drag with
/// this tool was a dead gesture. It assigned on touch-down and then dragged a
/// deactivated tool around.
///
/// Telling a tap from a drag is why the commit moved from `onPointerDown` to
/// `onPointerUp`, which is where `RectangleTool` and `BorderTool` already
/// decide the same question. The lasso itself is the `WallTool` shape rather
/// than theirs: it accumulates a stroke, so it has to latch during move.
///
/// While aiming it draws a line from every pedestrian it would affect to the
/// pointer -- the original's `drawMarkTargetLine`, which turned yellow over a
/// wall. Here the lines take the colour of the wall underneath, so you can see
/// which goal you are about to assign and, since pedestrians wear their goal's
/// colour, what the crowd will become.
@MainActor
public final class GoalTool: Tool {
  public let id = ToolId.goal
  private var mouse: Point?
  private var color: RGB?
  private var pressAt: Point?
  private var lasso: [Point] = []
  private var dragging = false

  /// Sampling gap along the lasso, in screen points. `WallTool` uses 3 for a
  /// wall, whose corners are the shape; a selection outline only has to contain
  /// people, so it can afford the web's coarser 4 (`selectionTool.ts:31`).
  private static let SAMPLE_SPACING_PX: Double = 4

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    pressAt = e.world
    lasso = [e.world]
    dragging = false
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    color = ctx.colorAt(e.world)
    if let press = pressAt, e.buttons != 0 {
      let perPixel = ctx.worldPerPixel()
      if !dragging && distance(press, e.world) >= DRAG_THRESHOLD * perPixel {
        dragging = true
      }
      if dragging, let last = lasso.last,
         distance(last, e.world) >= Self.SAMPLE_SPACING_PX * perPixel {
        lasso.append(e.world)
      }
    }
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    let press = pressAt
    pressAt = nil
    let wasDrag = dragging
    dragging = false
    // No hover on iOS: once the finger is gone there is no pointer to preview
    // under, and a ghost left at the last touch point sits there for the rest
    // of the session. The web keeps it because a mouse really is still there.
    mouse = nil
    color = nil
    defer { ctx.requestRender() }

    guard let press else { lasso = []; return }

    if wasDrag {
      let shape = outline(from: press, to: e.world)
      lasso = []
      if ctx.selectPedestriansIn(shape) == 0 {
        ctx.notify("Nobody in there — circle some pedestrians, or tap a wall to send everyone.")
      }
      // The tool stays armed either way: a selection is made in order to be
      // sent somewhere, and that is the very next tap.
      return
    }

    lasso = []
    if !ctx.setGoalAt(e.world) {
      // A goal is a wall, so a tap on empty ground assigned nothing. Say so, and
      // leave both the tool and the selection it was aimed at alone -- the tap
      // was a miss, and clearing up after a miss would mean lassoing the same
      // group again to have another go.
      ctx.notify("No wall there — tap a wall to make it the goal.")
      return
    }
    // Assigning a goal completes the gesture: drop the selection it applied to,
    // and step off the tool so the next tap cannot reassign by accident.
    ctx.clearSelection()
    ctx.deactivateTool()
  }

  public func cancel() {
    mouse = nil
    color = nil
    pressAt = nil
    lasso = []
    dragging = false
  }

  public func preview() -> ToolPreview {
    if dragging, let press = pressAt {
      var p = ToolPreview()
      p.selectionPolygon = outline(from: press, to: lasso.last ?? press)
      // No target lines mid-lasso: you are choosing *who*, not *where*, and a
      // fan of lines to the pointer is noise over the shape being drawn.
      return p
    }
    guard let mouse else { return .empty }
    var p = ToolPreview()
    p.targetLines = TargetLines(to: mouse, color: color)
    p.cursorGhost = CursorGhost(kind: .target, at: mouse, size: 10)
    return p
  }

  /// The shape to select with. Ports `selectionTool.ts:110-129`.
  ///
  /// A slow, curved drag leaves enough points to use as a lasso. A quick
  /// straight one does not -- the pointer may report only two or three
  /// positions, and those enclose no area at all -- so it falls back to the
  /// rectangle between where the drag began and where it ended. Without this a
  /// fast drag selects nobody, which just reads as the tool being broken.
  ///
  /// The stroke is used raw: neither simplified nor hulled. A concave lasso
  /// around part of a crowd is the point, and a convex hull would swallow the
  /// people it was drawn around.
  private func outline(from: Point, to: Point) -> [Point] {
    if lasso.count >= 3 {
      let box = boundingArea(lasso)
      let enclosed = abs(signedArea2(lasso)) / 2
      // A genuine lasso covers a decent share of its own bounding box; a
      // straight smear covers almost none of it.
      if box > 0 && enclosed / box > 0.15 { return lasso }
    }
    return [Point(from.x, from.y), Point(to.x, from.y),
            Point(to.x, to.y), Point(from.x, to.y)]
  }

  private func boundingArea(_ poly: [Point]) -> Double {
    var minX = Double.infinity, minY = Double.infinity
    var maxX = -Double.infinity, maxY = -Double.infinity
    for p in poly {
      if p.x < minX { minX = p.x }
      if p.x > maxX { maxX = p.x }
      if p.y < minY { minY = p.y }
      if p.y > maxY { maxY = p.y }
    }
    return (maxX - minX) * (maxY - minY)
  }
}
