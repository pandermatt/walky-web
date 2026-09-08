import Foundation

/// Turns a block into a generator: somewhere people come out of.
/// Ports `src/tools/generatorTool.ts`.
///
/// **Marks rather than places, exactly as the goal tool does.** Any block on
/// the map can be a generator, the same way any block can be a goal -- you draw
/// a shape with the tools that draw shapes, and then say what it is. It used to
/// drop a square block of its own, which was a second way of making walls that
/// only this tool knew about, and it meant the one thing you would actually
/// reach for -- "people come out of *that* building" -- was the one thing it
/// could not do.
///
/// A generator is a wall in this port, so people appear beside it rather than
/// in it, on the side its goal is on: `WalkyWorld.generatorMouth` says why.
///
/// Tapping one that already is a generator takes it back off. A marking tool
/// with no un-marking gesture leaves undo as the only way out of a mistap, and
/// this is the same tap either way.
///
/// It steps off after a hit, as the goal tool does after assigning, so the next
/// tap on the map cannot mark something by accident. A miss keeps it in hand: a
/// tap on bare ground is a fat finger, not a change of mind.
@MainActor
public final class GeneratorTool: Tool {
  public let id = ToolId.generator
  private var mouse: Point?

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    mouse = e.world
    ctx.requestRender()
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    ctx.requestRender()
  }

  /// On the lift, as every other tool that commits on a tap does -- marking
  /// before the finger leaves gives no chance to reconsider.
  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    // No hover on iOS: once the finger is gone there is no pointer to preview
    // under, and a ghost left at the last touch point sits there all session.
    mouse = nil

    if ctx.markGenerator(e.world) {
      ctx.deactivateTool()
    } else {
      ctx.notify("No block there — tap one to make it a generator.")
    }
    ctx.requestRender()
  }

  public func cancel() {
    mouse = nil
  }

  public func preview() -> ToolPreview {
    guard let mouse else { return .empty }
    var p = ToolPreview()
    // The same ring the goal tool aims with: the two ask the same kind of
    // question of the same kind of thing, and should not look like two
    // different gestures.
    p.cursorGhost = CursorGhost(kind: .target, at: mouse, size: 10)
    return p
  }
}
