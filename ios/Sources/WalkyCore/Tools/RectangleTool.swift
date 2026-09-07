import Foundation

/// Rectangular wall, from `controller/RectangleWallToolMouseListener`.
/// Ports `src/tools/rectangleTool.ts`.
///
/// Accepts both gestures. The original was click-then-click-again; dragging is
/// the gesture most people reach for first, so a press-move-release that travels
/// far enough commits the rectangle directly, while a press and release in
/// roughly the same spot falls back to the original two-click mode.
@MainActor
public final class RectangleTool: Tool {
  public let id = ToolId.rectangle

  /// First corner, once placed by a click.
  private var first: Point?
  /// Where the pointer went down, while it is still down.
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
    guard let press = pressAt else { pressAt = nil; return }
    pressAt = nil
    let here = snap(e.world)

    // Multiplied by worldPerPixel where rectangleTool.ts:42 does not -- see
    // DRAG_THRESHOLD in Tool.swift.
    if distance(press, here) >= DRAG_THRESHOLD * ctx.worldPerPixel() {
      // Dragged: the press and release are the two corners.
      commit(press, here, ctx)
      return
    }

    // Treated as a click: first sets a corner, second completes.
    guard let f = first else {
      first = press
    // No hover on iOS: once the finger is gone there is no pointer to preview
    // under, and a ghost left at the last touch point sits there for the rest
    // of the session. The web keeps it because a mouse really is still there.
      mouse = nil
      ctx.requestRender()
      return
    }
    commit(f, here, ctx)
  }

  public func cancel() {
    first = nil
    pressAt = nil
    mouse = nil
  }

  public func preview() -> ToolPreview {
    let anchor = pressAt ?? first
    if let anchor, let mouse {
      var p = ToolPreview()
      p.pendingRect = (anchor, mouse)
      return p
    }
    var p = ToolPreview()
    if let mouse { p.cursorGhost = CursorGhost(kind: .square, at: mouse, size: 9) }
    return p
  }

  private func commit(_ a: Point, _ b: Point, _ ctx: ToolContext) {
    if abs(b.x - a.x) >= 1 && abs(b.y - a.y) >= 1 {
      _ = ctx.addWall(rectanglePolygon(a, b), nil)
    }
    cancel()
    ctx.requestRender()
  }
}
