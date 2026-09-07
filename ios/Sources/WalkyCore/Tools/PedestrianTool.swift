import Foundation

/// Adds pedestrians, from `controller/PedestrianMouseListener`: a tap drops an
/// n x n block and dragging paints continuously, so a crowd can be laid down in
/// one gesture. Ports `src/tools/pedestrianTool.ts`.
@MainActor
public final class PedestrianTool: Tool {
  public let id = ToolId.pedestrian
  private var painting = false
  /// Ghost dots for the block under the cursor, as `drawTemporaryPedestrians` did.
  private var ghost: [Point] = []

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    painting = true
    ctx.addPedestrians(e.world)
    ghost = ctx.pedestrianBlock(e.world, nil)
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    if painting && e.buttons != 0 { ctx.addPedestrians(e.world) }
    // Recomputed after placing, so the preview shows only spots still free.
    ghost = ctx.pedestrianBlock(e.world, nil)
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) { painting = false }

  public func cancel() {
    painting = false
    ghost = []
  }

  public func preview() -> ToolPreview {
    var p = ToolPreview()
    p.pendingPedestrians = ghost
    return p
  }
}
