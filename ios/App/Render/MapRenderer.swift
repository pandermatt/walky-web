import SwiftUI
import WalkyCore

/// Draws the map. Ports `render/scene.ts` and `render/overlay.ts` into one
/// Core Graphics pass.
///
/// The cost of a `Canvas` is not rasterization, it is per-frame allocation:
/// every `Path { addEllipse }` is a fresh `CGMutablePath`, and 500 of those at
/// 60 Hz is 30,000 allocations a second. So:
///
///  - the transform is set **once** and everything is drawn in world space,
///    which lets wall paths be cached across frames against `worldRevision`;
///  - agents are batched by packed colour, which collapses to two fills once a
///    goal is marked (everyone wears the goal's colour, the arrived are black);
///  - anything outside the visible world rect is skipped.
///
/// No `drawingGroup()`: it would add an offscreen pass and a rasterization per
/// frame to something already drawn efficiently.
@MainActor
final class RenderCache {
  private var wallsRevision = -1
  private(set) var wallPaths: [(path: Path, color: RGB, isGoal: Bool)] = []
  private(set) var hullPaths: [(path: Path, color: RGB)] = []

  func refresh(_ world: WalkyWorld) {
    guard wallsRevision != world.worldRevision else { return }
    wallsRevision = world.worldRevision

    wallPaths = world.walls.map { wall in
      var p = Path()
      for polygon in wall.polygons where polygon.count >= 3 {
        p.move(to: CGPoint(x: polygon[0].x, y: polygon[0].y))
        for q in polygon.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
        p.closeSubpath()
      }
      return (p, wall.color, wall.isGoal)
    }

    // One dashed outline per connected group of touching shapes, not per wall.
    hullPaths = groupWalls(world.walls).compactMap { group in
      guard group.hull.count >= 3 else { return nil }
      guard let first = world.walls.first(where: { $0.id == group.wallIds[0] }) else { return nil }
      var p = Path()
      p.move(to: CGPoint(x: group.hull[0].x, y: group.hull[0].y))
      for q in group.hull.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
      p.closeSubpath()
      return (p, first.color)
    }
  }
}

@MainActor
enum MapRenderer {
  static func color(_ c: RGB, _ alpha: Double = 1) -> Color {
    Color(red: Double(c.r) / 255, green: Double(c.g) / 255, blue: Double(c.b) / 255)
      .opacity(alpha)
  }

  static func draw(_ world: WalkyWorld, _ cache: RenderCache,
                   into ctx: inout GraphicsContext, size: CGSize) {
    world.prepareForRender()
    cache.refresh(world)

    var vp = world.viewport
    vp.width = size.width
    vp.height = size.height
    world.viewport = vp
    let scale = vp.scale

    ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color(BACKGROUND)))

    // World space from here down: one transform rather than converting every
    // point, which is what makes the cached wall paths reusable.
    ctx.translateBy(x: size.width / 2, y: size.height / 2)
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -vp.targetX, y: -vp.targetY)

    // A line width in points becomes this in world units.
    let hairline = 1 / scale

    for w in cache.wallPaths {
      ctx.fill(w.path, with: .color(color(w.color)))
      // The shadow every wall casts, as java.awt.Color.darker() twice.
      ctx.stroke(w.path, with: .color(color(shadowOf(w.color))), lineWidth: hairline)
    }

    if world.settings.showConvexHull {
      // DASH = [9, 9] in screen points, so divided by the scale to stay 9pt at
      // every zoom -- the dashes are chrome, not part of the map.
      let dash = StrokeStyle(lineWidth: hairline, dash: [9 / scale, 9 / scale])
      for h in cache.hullPaths {
        ctx.stroke(h.path, with: .color(color(h.color, 0.55)), style: dash)
      }
    }

    drawAgents(world, into: &ctx, hairline: hairline)
    drawPreview(world, into: &ctx, hairline: hairline, scale: scale)
  }

  /// Batched by packed colour: one fill per distinct colour rather than per
  /// agent. A freshly painted rainbow crowd is the worst case; a crowd aimed at
  /// a goal is two fills.
  private static func drawAgents(_ world: WalkyWorld, into ctx: inout GraphicsContext,
                                 hairline: Double) {
    let a = world.agents
    guard a.count > 0 else { return }
    let r = world.settings.pedestrianRadius

    var byColor: [UInt32: Path] = [:]
    for i in 0..<a.count {
      let x = Double(a.x[i]), y = Double(a.y[i])
      byColor[a.color[i], default: Path()].addEllipse(
        in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }
    // The white ring every pedestrian wears, from PedestrianPanel.drawPedestrian.
    var all = Path()
    for (packed, path) in byColor {
      ctx.fill(path, with: .color(color(unpackRgb(packed))))
      all.addPath(path)
    }
    ctx.stroke(all, with: .color(color(WHITE)), lineWidth: hairline)

    if world.settings.showPersonalSpace {
      var rings = Path()
      for i in 0..<a.count {
        let s = Double(a.effectiveSpace[i])
        if s <= 0 { continue }
        let x = Double(a.x[i]), y = Double(a.y[i]), rr = r + s
        rings.addEllipse(in: CGRect(x: x - rr, y: y - rr, width: rr * 2, height: rr * 2))
      }
      ctx.stroke(rings, with: .color(color(WHITE, 0.25)), lineWidth: hairline)
    }
  }

  /// What the armed tool is about to do. Ports the tool-preview half of
  /// `overlay.ts`, drawn over the map rather than under it.
  private static func drawPreview(_ world: WalkyWorld, into ctx: inout GraphicsContext,
                                  hairline: Double, scale: Double) {
    guard let preview = world.tool?.preview() else { return }
    let dash = StrokeStyle(lineWidth: hairline, dash: [9 / scale, 9 / scale])

    if !preview.pendingWallPoints.isEmpty {
      var p = Path()
      let pts = preview.pendingWallPoints
      p.move(to: CGPoint(x: pts[0].x, y: pts[0].y))
      for q in pts.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
      if preview.pendingWallTracing { p.closeSubpath() }
      ctx.stroke(p, with: .color(color(WHITE)), style: dash)
      if !preview.pendingWallTracing {
        var dots = Path()
        for q in pts {
          dots.addEllipse(in: CGRect(x: q.x - 5 / scale, y: q.y - 5 / scale,
                                     width: 10 / scale, height: 10 / scale))
        }
        ctx.fill(dots, with: .color(color(WHITE)))
      }
    }

    if let rect = preview.pendingRect {
      let r = CGRect(x: min(rect.0.x, rect.1.x), y: min(rect.0.y, rect.1.y),
                     width: abs(rect.1.x - rect.0.x), height: abs(rect.1.y - rect.0.y))
      ctx.stroke(Path(r), with: .color(color(WHITE)), style: dash)
    }

    if !preview.pendingPolygons.isEmpty {
      // Red says the shape would be unusable -- a frame with no room inside.
      let tint = preview.pendingPolygonsInvalid ? RED : WHITE
      let width = preview.pendingPolygonsInvalid ? 2 / scale : hairline
      var p = Path()
      for poly in preview.pendingPolygons where poly.count >= 2 {
        p.move(to: CGPoint(x: poly[0].x, y: poly[0].y))
        for q in poly.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
        p.closeSubpath()
      }
      ctx.stroke(p, with: .color(color(tint)),
                 style: StrokeStyle(lineWidth: width, dash: [9 / scale, 9 / scale]))
    }

    if !preview.pendingPedestrians.isEmpty {
      let r = world.settings.pedestrianRadius
      var p = Path()
      for q in preview.pendingPedestrians {
        p.addEllipse(in: CGRect(x: q.x - r, y: q.y - r, width: r * 2, height: r * 2))
      }
      ctx.fill(p, with: .color(color(WHITE, 0.55)))
    }

    // Lines from every pedestrian to the pointer, so you can see what the crowd
    // is about to become. Ports drawMarkTargetLine.
    if let lines = preview.targetLines {
      let a = world.agents
      var p = Path()
      for i in 0..<a.count where a.arrived[i] == 0 {
        p.move(to: CGPoint(x: Double(a.x[i]), y: Double(a.y[i])))
        p.addLine(to: CGPoint(x: lines.to.x, y: lines.to.y))
      }
      ctx.stroke(p, with: .color(color(lines.color ?? ORANGE, 0.8)), lineWidth: hairline)
    }

    if let ghost = preview.cursorGhost {
      // Only ever drawn while a touch is down -- there is no hover on iOS, and
      // a ghost parked at the last touch point is exactly the artefact to avoid.
      let s = ghost.size / scale
      let box = CGRect(x: ghost.at.x - s, y: ghost.at.y - s, width: s * 2, height: s * 2)
      switch ghost.kind {
      case .square, .eraser:
        ctx.stroke(Path(box), with: .color(color(WHITE)), lineWidth: hairline)
      case .frame:
        ctx.stroke(Path(box), with: .color(color(WHITE)), lineWidth: 3 / scale)
      case .target, .squiggle:
        ctx.stroke(Path(ellipseIn: box), with: .color(color(ORANGE)), lineWidth: 2 / scale)
      }
    }
  }
}
