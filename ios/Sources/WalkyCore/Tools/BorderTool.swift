import Foundation

/// Draws an enclosure: a hollow rectangular frame, from
/// `controller/BorderToolMouseListener`. Ports `src/tools/borderTool.ts`.
///
/// The only tool that makes a shape with an inside. The frame is committed as a
/// single wall of four bars, not four walls: it is one object conceptually, and
/// building it atomically means it never depends on walls being merged, which is
/// what used to make enclosures swallow everything drawn against them.
@MainActor
public final class BorderTool: Tool {
  public let id = ToolId.border

  private var first: Point?
  private var pressAt: Point?
  private var mouse: Point?
  /// `preview()` has no context, so the sizes it needs are cached on the way past.
  private var thickness: Double = 12
  private var radius: Double = 13

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    pressAt = snap(e.world)
    mouse = e.world
    readSettings(ctx)
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    readSettings(ctx)
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    guard let press = pressAt else { pressAt = nil; return }
    pressAt = nil
    let here = snap(e.world)

    if distance(press, here) >= DRAG_THRESHOLD * ctx.worldPerPixel() {
      commit(press, here, ctx)
      return
    }
    guard let f = first else {
      first = press
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
    guard let anchor, let mouse else {
      var p = ToolPreview()
      if let mouse { p.cursorGhost = CursorGhost(kind: .frame, at: mouse, size: 9) }
      return p
    }
    var p = ToolPreview()
    p.pendingPolygons = borderFrame(anchor, mouse, thickness)
    // Drawn in warning colour when the frame would have no usable interior.
    p.pendingPolygonsInvalid = !borderFits(anchor, mouse, thickness, radius)
    return p
  }

  private func readSettings(_ ctx: ToolContext) {
    let s = ctx.settings()
    thickness = s.borderThickness
    radius = s.pedestrianRadius
  }

  private func commit(_ a: Point, _ b: Point, _ ctx: ToolContext) {
    if borderFits(a, b, thickness, radius) {
      // Flagged as a border: the dashed hull skips it, since a frame's hull is
      // the room it encloses rather than the shape itself. See Wall.isBorder.
      _ = ctx.addWallShape(borderFrame(a, b, thickness), WallOptions(isBorder: true))
    }
    cancel()
    ctx.requestRender()
  }
}
