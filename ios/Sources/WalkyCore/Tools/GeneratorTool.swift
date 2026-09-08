import Foundation

/// Puts down a door: a block that lets pedestrians out while the run is on.
/// Ports `src/tools/generatorTool.ts`.
///
/// One tap rather than the brush's stroke. The pedestrian tool paints, because
/// a crowd is a quantity and painting is how you say how much; a door is a
/// single thing standing somewhere, and dragging would leave behind a row of
/// them nobody meant to open.
///
/// The preview is the real block at the real size and with the real rounded
/// corners rather than a cursor badge -- the footprint follows the pedestrian
/// radius, so drawing it is the only honest way to say how much room it is
/// about to take. It goes red where the block has no room for anybody to stand
/// in, and a tap there is refused: a door built inside a wall could never let
/// anybody out, which is the bargain the border tool strikes with a frame too
/// small to hold a crowd.
///
/// It puts itself away after a placement, as `MeasureTool` does after its
/// second tap. That costs a trip to the menu for a second door, and buys the
/// thing a menu tool needs more: a tool with no cell in the bar is a mode you
/// cannot see you are in, so one that stayed armed would turn the next tap
/// meant for the map into another door. Arming it says so out loud (see
/// `AppModel.armedHint`), and placing one ends the sentence.
@MainActor
public final class GeneratorTool: Tool {
  public let id = ToolId.generator
  private var mouse: Point?
  /// `preview()` has no context, so what it needs is cached on the way past.
  private var radius: Double = 13
  private var blocked = false

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    mouse = e.world
    read(e.world, ctx)
    // Only on success, the way `MeasureTool` and `GoalTool` hold on after a
    // miss: a tap the world declined leaves the tool in hand so it costs a
    // second try rather than a trip back to the menu. The refusal is already
    // on screen -- `read` turned the preview red a frame ago -- and the world
    // says it as well, so there is nothing to add here.
    if ctx.addGenerator(e.world) { ctx.deactivateTool() }
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    read(e.world, ctx)
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    // No hover on iOS: once the finger is gone there is no pointer to preview
    // under, and a ghost left at the last touch point sits there for the rest
    // of the session.
    mouse = nil
    ctx.requestRender()
  }

  public func cancel() {
    mouse = nil
    blocked = false
  }

  /// The sizes and the verdict `preview()` will need, taken while there is a
  /// context to ask.
  private func read(_ at: Point, _ ctx: ToolContext) {
    radius = ctx.settings().pedestrianRadius
    blocked = ctx.pedestrianBlock(at, GENERATOR_CELLS).isEmpty
  }

  public func preview() -> ToolPreview {
    guard let mouse else { return .empty }
    var p = ToolPreview()
    p.pendingPolygons = [generatorSquare(mouse, radius)]
    p.pendingPolygonsInvalid = blocked
    return p
  }
}
