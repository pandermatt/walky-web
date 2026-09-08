import Foundation
import WalkySim

/// Tap A, tap B, and price the walk between them.
///
/// The one tool with nothing to add to the map. It asks a question about the
/// map instead, and the answer lives on `WalkyWorld` rather than in here --
/// `preview()` is only called while a tool is armed, and the whole point of a
/// measurement is to still be on screen after you have switched to the wall
/// tool, blocked a passage, and come back to see what it cost.
@MainActor
public final class MeasureTool: Tool {
  public let id = ToolId.measure

  /// The first point, once placed.
  private var first: Point?
  private var pressAt: Point?
  private var mouse: Point?

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    pressAt = snap(e.world)
    mouse = e.world
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    guard let press = pressAt else { return }
    pressAt = nil
    let here = snap(e.world)

    // Dragged far enough: the press and release are both ends at once.
    // Multiplied by worldPerPixel for the reason DRAG_THRESHOLD documents.
    if distance(press, here) >= DRAG_THRESHOLD * ctx.worldPerPixel() {
      commit(press, here, ctx)
      return
    }

    guard let a = first else {
      first = press
      // No hover on iOS: without this the ghost parks itself at the last touch.
      mouse = nil
      ctx.requestRender()
      return
    }
    commit(a, here, ctx)
  }

  public func cancel() {
    first = nil
    pressAt = nil
    mouse = nil
  }

  public func preview() -> ToolPreview {
    var p = ToolPreview()
    // The placed first point, and a rubber band to wherever the finger is.
    if let first {
      p.pendingWallPoints = mouse.map { [first, $0] } ?? [first]
      p.pendingWallTracing = true          // an open line, not a closing outline
    } else if let mouse {
      p.cursorGhost = CursorGhost(kind: .target, at: mouse, size: 9)
    }
    return p
  }

  /// Measuring the same point twice is not a measurement.
  private func commit(_ a: Point, _ b: Point, _ ctx: ToolContext) {
    cancel()
    guard distance(a, b) > 1 else {
      // A fat-fingered tap, not a measurement: stay in hand so it costs a
      // second tap rather than a trip back to the menu.
      ctx.requestRender()
      return
    }
    ctx.measure(a, b)
    // Two taps is the whole gesture, so step off the tool -- the same reason
    // `GoalTool` does after a hit. The measurement itself lives on the world
    // and stays drawn, which is what makes disarming safe: putting the tool
    // away does not put the answer away with it.
    ctx.deactivateTool()
    ctx.requestRender()
  }
}
