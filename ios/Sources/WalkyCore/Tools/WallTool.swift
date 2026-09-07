import Foundation

/// Freehand polygon wall, from `controller/WallToolMouseListener`.
/// Ports `src/tools/wallTool.ts`.
///
/// Two gestures, as the rectangle tool has two: drag to trace a shape, with
/// points sampled along the path and the outline closing on release; or tap to
/// place individual vertices, double-tap to close.
///
/// A traced stroke is simplified before it becomes a wall. Sampling produces a
/// point every few points of travel -- hundreds for one shape -- and each would
/// be a polygon vertex. Vertex count drives the whole navigation pipeline: the
/// split into convex parts, and the O(n^2) visibility sweep over the resulting
/// corners. Simplifying first keeps the shape while cutting that by an order of
/// magnitude.
@MainActor
public final class WallTool: Tool {
  public let id = ToolId.wall

  /// Minimum gap between placed vertices in tap mode, in world units.
  private static let MINIMUM_DISTANCE: Double = 10
  /// Sampling gap while tracing, in screen points.
  private static let SAMPLE_SPACING_PX: Double = 3
  /// How far the simplified outline may stray from the traced one, in points.
  private static let SIMPLIFY_TOLERANCE_PX: Double = 2.5
  /// Past this, a press-and-release counts as a trace rather than a tap.
  private static let DRAG_THRESHOLD_PX: Double = 5

  /// Vertices placed by tapping.
  private var points: [Point] = []
  /// Raw samples of the current trace.
  private var stroke: [Point] = []
  private var pressAt: Point?
  private var tracing = false
  private var mouse: Point?

  public init() {}

  public func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) {
    if e.buttons != 1 { return }
    pressAt = e.world
    stroke = [e.world]
    tracing = false
  }

  public func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) {
    mouse = e.world
    if let press = pressAt, e.buttons != 0 {
      let perPixel = ctx.worldPerPixel()
      if !tracing && distance(press, e.world) >= Self.DRAG_THRESHOLD_PX * perPixel {
        tracing = true
      }
      if tracing {
        if let last = stroke.last {
          if distance(last, e.world) >= Self.SAMPLE_SPACING_PX * perPixel {
            stroke.append(e.world)
          }
        } else {
          stroke.append(e.world)
        }
      }
    }
    ctx.requestRender()
  }

  public func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) {
    let press = pressAt
    pressAt = nil
    if press == nil { return }

    if tracing {
      commitTrace(ctx)
      return
    }

    // Not a drag: place a vertex, as the original's click mode did.
    stroke = []
    addPoint(e.world, force: false)
    ctx.requestRender()
  }

  public func onDoubleTap(_ e: PointerInfo, _ ctx: ToolContext) {
    addPoint(e.world, force: true)
    if points.count >= 3 { _ = ctx.addWall(points, nil) }
    cancel()
    ctx.requestRender()
  }

  public func cancel() {
    points = []
    stroke = []
    pressAt = nil
    tracing = false
  }

  public func preview() -> ToolPreview {
    var p = ToolPreview()
    // While tracing, show the raw stroke; the reduction happens on release.
    p.pendingWallPoints = (tracing && stroke.count > 1) ? stroke : points
    p.pendingWallTracing = tracing
    if let mouse, !tracing {
      p.cursorGhost = CursorGhost(kind: .squiggle, at: mouse, size: 14)
    }
    return p
  }

  private func commitTrace(_ ctx: ToolContext) {
    let tolerance = Self.SIMPLIFY_TOLERANCE_PX * ctx.worldPerPixel()
    let simplified = simplifyClosed(stroke, tolerance).map { Point(jsRound($0.x), jsRound($0.y)) }
    if simplified.count >= 3 { _ = ctx.addWall(simplified, nil) }
    cancel()
    ctx.requestRender()
  }

  private func addPoint(_ p: Point, force: Bool) {
    let last = points.last
    if !force, let last, distance(last, p) < Self.MINIMUM_DISTANCE { return }
    if let last, last.x == p.x, last.y == p.y { return }
    points.append(Point(jsRound(p.x), jsRound(p.y)))
  }
}
