import Foundation

/// Marks a wall as the goal, from `controller/MarkGoalToolMouseListener`.
/// Ports `src/tools/goalTool.ts`.
///
/// While active it draws a line from every pedestrian it would affect to the
/// pointer -- the original's `drawMarkTargetLine`, which turned yellow over a
/// wall. Here the lines take the colour of the wall underneath, so you can see
/// which goal you are about to assign and, since pedestrians wear their goal's
/// colour, what the crowd will become.
@MainActor
public final class GoalTool: Tool {
  public let id = ToolId.goal
  private var mouse: Point?
  private var color: RGB?

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
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

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    color = ctx.colorAt(e.world)
    ctx.requestRender()
  }

  public func cancel() {
    mouse = nil
    color = nil
  }

  public func preview() -> ToolPreview {
    guard let mouse else { return .empty }
    var p = ToolPreview()
    p.targetLines = TargetLines(to: mouse, color: color)
    p.cursorGhost = CursorGhost(kind: .target, at: mouse, size: 10)
    return p
  }
}
