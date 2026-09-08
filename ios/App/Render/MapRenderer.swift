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
  private var hullRadius = -1.0
  private(set) var wallPaths: [(path: Path, color: RGB, isGoal: Bool, isDoor: Bool)] = []
  private(set) var hullPaths: [(path: Path, color: RGB)] = []
  private(set) var partPaths: [(path: Path, color: RGB)] = []
  private var goalPathKey = ""
  private(set) var goalPaths = Path()

  func refresh(_ world: WalkyWorld) {
    // The hulls are expanded by the pedestrian radius, so the radius setting
    // invalidates them as surely as an edit does.
    let radius = world.settings.pedestrianRadius
    guard wallsRevision != world.worldRevision || hullRadius != radius else { return }
    wallsRevision = world.worldRevision
    hullRadius = radius

    wallPaths = world.walls.map { wall in
      var p = Path()
      for polygon in wall.polygons where polygon.count >= 3 {
        p.move(to: CGPoint(x: polygon[0].x, y: polygon[0].y))
        for q in polygon.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
        p.closeSubpath()
      }
      return (p, wall.color, wall.isGoal, wall.generator != nil)
    }

    // One dashed outline per connected group of touching shapes, not per wall.
    //
    // Expanded by the pedestrian radius, which is the whole point of drawing
    // it. The raw hull of a rectangle *is* that rectangle, so an unexpanded
    // outline lands exactly on the wall's own edge and reads as missing --
    // and worse, it would show a boundary pedestrians appear to cross, because
    // what cannot enter a wall is a circle, not a point. Expanded, the dashed
    // line is exactly where a pedestrian's centre may go, and it is the same
    // geometry the navigation graph and the legality checks use.
    hullPaths = groupWalls(world.walls).compactMap { group in
      guard group.hull.count >= 3 else { return nil }
      guard let first = world.walls.first(where: { $0.id == group.wallIds[0] }) else { return nil }
      // The group's colour is its lowest-numbered member's, so it holds still
      // as unrelated shapes are drawn elsewhere.
      return (ring(expandPolygon(group.hull, radius)), first.color)
    }

    // The convex parts a wall was decomposed into: a diagnostic for how a shape
    // was split, off by default. Already expanded -- these are the obstacles
    // navigation actually runs on.
    partPaths = world.nav.obstacles.compactMap { ob in
      guard let wall = world.walls.first(where: { $0.id == ob.wallId }) else { return nil }
      return (ring(ob.hull), wall.color)
    }
  }

  /// The route each pedestrian is going to walk.
  ///
  /// Ports `app.ts:1978`. Two things there are load-bearing rather than
  /// incidental:
  ///
  /// A pedestrian *with* a waypoint reads its remaining route straight off the
  /// Dijkstra predecessors, which costs nothing. One *without* has to have its
  /// route predicted, and that is a full graph scan each -- so it is skipped
  /// while running, where an agent without a waypoint is one whose route just
  /// failed, and re-searching it every frame would put the per-agent search
  /// back into the loop the whole navigation rewrite took it out of.
  ///
  /// Capped at 1500. Past that the picture is an unreadable mat of lines and
  /// building one array per agent per frame costs more than the simulation.
  func refreshGoalPaths(_ world: WalkyWorld) {
    let key = "\(world.worldRevision):\(world.agentRevision):\(world.running ? 1 : 0)"
    guard goalPathKey != key else { return }
    goalPathKey = key

    var out = Path()
    let a = world.agents
    var drawn = 0
    for i in 0..<a.count where drawn < 1500 {
      if a.arrived[i] != 0 { continue }
      let goalId = Int(a.goal[i])
      if goalId < 0 { continue }
      let head = Point(Double(a.x[i]), Double(a.y[i]))

      var path: [Point]
      if a.hasWaypoint[i] != 0 {
        let rest = world.nav.pathFromNode(Int(a.waypointNode[i]), goalId)
        path = rest.isEmpty
          ? [head, Point(Double(a.waypointX[i]), Double(a.waypointY[i]))]
          : [head] + rest
      } else {
        if world.running { continue }
        path = world.nav.routeFrom(head, goalId)
      }
      if path.count < 2 { continue }

      out.move(to: CGPoint(x: path[0].x, y: path[0].y))
      for q in path.dropFirst() { out.addLine(to: CGPoint(x: q.x, y: q.y)) }
      drawn += 1
    }
    goalPaths = out
  }

  private func ring(_ points: [Point]) -> Path {
    var p = Path()
    guard let first = points.first else { return p }
    p.move(to: CGPoint(x: first.x, y: first.y))
    for q in points.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
    p.closeSubpath()
    return p
  }
}

@MainActor
enum MapRenderer {
  static func color(_ c: RGB, _ alpha: Double = 1) -> Color {
    Color(red: Double(c.r) / 255, green: Double(c.g) / 255, blue: Double(c.b) / 255)
      .opacity(alpha)
  }

  static func draw(_ world: WalkyWorld, _ cache: RenderCache, _ stats: DebugStats,
                   basemap: Basemap.Sheet?,
                   into ctx: inout GraphicsContext, size: CGSize) {
    cache.refresh(world)
    if world.settings.showLineToTarget { cache.refreshGoalPaths(world) }

    var vp = world.viewport
    vp.width = size.width
    vp.height = size.height
    world.viewport = vp
    let scale = vp.scale

    // The ground and every outline drawn over it come from the chosen theme.
    // On the classic ground these are exactly BACKGROUND and WHITE, so nothing
    // about the original's look depends on the theme existing.
    let ground = world.settings.ground
    let ink = ground.ink
    ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color(ground.background)))

    // Kept before the world transform, for anything drawn in screen units.
    var screen = ctx

    // World space from here down: one transform rather than converting every
    // point, which is what makes the cached wall paths reusable.
    ctx.translateBy(x: size.width / 2, y: size.height / 2)
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -vp.targetX, y: -vp.targetY)

    // Apple's map, if a real place has been imported. Drawn in world space
    // like everything below it, so it pans and zooms with the crowd rather
    // than being chased frame by frame; the ground fill above is the letterbox
    // around it. See Basemap.
    if let basemap, world.settings.showBasemap, world.geoAnchor != nil {
      ctx.draw(Image(decorative: basemap.image, scale: 1), in: basemap.worldRect)
    }

    // A line width in points becomes this in world units.
    let hairline = 1 / scale

    // A generator is a wall drawn with the fill taken out: a dashed outline
    // over a faded interior. That is two cues apart from colour -- where a wall
    // is solid a generator is hollow, and where a wall's edge is a line a
    // generator's is a dashed one -- which is what makes them tellable apart
    // without relying on colour at all. On a scanned map there is a third: a
    // real wall is `WALL_THICKNESS` thick where a doorway is a thin slab.
    let doorDash = StrokeStyle(lineWidth: 2 / scale, dash: [7 / scale, 5 / scale])
    for w in cache.wallPaths {
      if w.isDoor {
        ctx.fill(w.path, with: .color(color(w.color, 0.22)))
        ctx.stroke(w.path, with: .color(color(w.color)), style: doorDash)
        continue
      }
      ctx.fill(w.path, with: .color(color(w.color)))
      // The shadow every wall casts, as java.awt.Color.darker() twice.
      ctx.stroke(w.path, with: .color(color(shadowOf(w.color))), lineWidth: hairline)
    }

    // DASH = [9, 9] in screen points, so divided by the scale to stay 9pt at
    // every zoom -- the dashes are chrome, not part of the map.
    let dash = StrokeStyle(lineWidth: hairline, dash: [9 / scale, 9 / scale])
    // Parts first: where both are on, the hull is the one drawn over the top.
    if world.settings.showConvexParts {
      for h in cache.partPaths {
        ctx.stroke(h.path, with: .color(color(h.color, 0.35)), style: dash)
      }
    }
    if world.settings.showConvexHull {
      for h in cache.hullPaths {
        ctx.stroke(h.path, with: .color(color(h.color)), style: dash)
      }
    }

    // Under the crowd: the route belongs to the map the pedestrians walk on,
    // and drawn over them it would hide the dots it is about.
    if world.settings.showLineToTarget {
      ctx.stroke(cache.goalPaths, with: .color(color(ORANGE)),
                 style: StrokeStyle(lineWidth: 2 / scale, lineCap: .round, lineJoin: .round))
    }

    // The measurement sits with the map rather than over the crowd, for the
    // same reason the goal route does.
    if let measurement = world.measurement {
      drawMeasurement(measurement, into: &ctx, scale: scale, ink: ink)
    }

    // A lassoed generator, marked as the selected pedestrians are.
    for door in world.generators where door.selected {
      var p = Path()
      for polygon in door.polygons where polygon.count >= 3 {
        p.move(to: CGPoint(x: polygon[0].x, y: polygon[0].y))
        for q in polygon.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
        p.closeSubpath()
      }
      ctx.stroke(p, with: .color(color(YELLOW)), lineWidth: 2 / scale)
    }

    drawAgents(world, into: &ctx, hairline: hairline, ink: ink)
    drawPreview(world, into: &ctx, hairline: hairline, scale: scale, ink: ink)

    // Screen space: a label drawn in world units would grow with the zoom.
    if let measurement = world.measurement {
      drawMeasurementLabel(measurement, world: world, into: &screen, size: size, ink: ink)
    }

    if world.settings.showDebug {
      drawDebug(debugLines(world, stats), into: &screen, size: size, ink: ink)
    }
  }

  /// Batched by packed colour: one fill per distinct colour rather than per
  /// agent. A freshly painted rainbow crowd is the worst case; a crowd aimed at
  /// a goal is two fills.
  private static func drawAgents(_ world: WalkyWorld, into ctx: inout GraphicsContext,
                                 hairline: Double, ink: RGB) {
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
    ctx.stroke(all, with: .color(color(ink)), lineWidth: hairline)

    // Who the next goal would apply to. A second ring outside the ink one
    // rather than a recoloured one: agents are batched into a single `Path` per
    // packed colour and stroked once, so per-agent line colour -- which is what
    // `scene.ts:283-285` does, deck.gl giving it away free -- would undo the
    // batching this method exists for. One extra pass, one extra stroke.
    var picked = Path()
    for i in 0..<a.count where a.selected[i] != 0 {
      let x = Double(a.x[i]), y = Double(a.y[i]), rr = r + hairline
      picked.addEllipse(in: CGRect(x: x - rr, y: y - rr, width: rr * 2, height: rr * 2))
    }
    ctx.stroke(picked, with: .color(color(YELLOW)), lineWidth: hairline * 2)

    if world.settings.showPersonalSpace {
      var rings = Path()
      for i in 0..<a.count {
        let s = Double(a.effectiveSpace[i])
        if s <= 0 { continue }
        let x = Double(a.x[i]), y = Double(a.y[i]), rr = r + s
        rings.addEllipse(in: CGRect(x: x - rr, y: y - rr, width: rr * 2, height: rr * 2))
      }
      ctx.stroke(rings, with: .color(color(ink, 0.25)), lineWidth: hairline)
    }
  }

  /// What the armed tool is about to do. Ports the tool-preview half of
  /// `overlay.ts`, drawn over the map rather than under it.
  private static func drawPreview(_ world: WalkyWorld, into ctx: inout GraphicsContext,
                                  hairline: Double, scale: Double, ink: RGB) {
    guard let preview = world.tool?.preview() else { return }
    let dash = StrokeStyle(lineWidth: hairline, dash: [9 / scale, 9 / scale])

    if !preview.pendingWallPoints.isEmpty {
      var p = Path()
      let pts = preview.pendingWallPoints
      p.move(to: CGPoint(x: pts[0].x, y: pts[0].y))
      for q in pts.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
      if preview.pendingWallTracing { p.closeSubpath() }
      ctx.stroke(p, with: .color(color(ink)), style: dash)
      if !preview.pendingWallTracing {
        var dots = Path()
        for q in pts {
          dots.addEllipse(in: CGRect(x: q.x - 5 / scale, y: q.y - 5 / scale,
                                     width: 10 / scale, height: 10 / scale))
        }
        ctx.fill(dots, with: .color(color(ink)))
      }
    }

    if let rect = preview.pendingRect {
      let r = CGRect(x: min(rect.0.x, rect.1.x), y: min(rect.0.y, rect.1.y),
                     width: abs(rect.1.x - rect.0.x), height: abs(rect.1.y - rect.0.y))
      ctx.stroke(Path(r), with: .color(color(ink)), style: dash)
    }

    // The lasso, in yellow so it cannot be read as a wall being traced -- both
    // are freehand dashed rings drawn with the same finger, and the colour is
    // the only thing that says which shape you are about to get.
    if let lasso = preview.selectionPolygon, lasso.count >= 2 {
      var p = Path()
      p.move(to: CGPoint(x: lasso[0].x, y: lasso[0].y))
      for q in lasso.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
      p.closeSubpath()
      ctx.stroke(p, with: .color(color(YELLOW)), style: dash)
    }

    if !preview.pendingPolygons.isEmpty {
      // Red says the shape would be unusable -- a frame with no room inside.
      let tint = preview.pendingPolygonsInvalid ? RED : ink
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
      ctx.fill(p, with: .color(color(ink, 0.55)))
    }

    // Lines from every pedestrian to the pointer, so you can see what the crowd
    // is about to become. Ports drawMarkTargetLine.
    if let lines = preview.targetLines {
      let a = world.agents
      // The same condition `setGoalAt` commits with. Without it the preview
      // promises to retarget the whole crowd while the tap retargets only the
      // lassoed ones -- the one thing a preview may not do. The web has always
      // had this branch (`app.ts:2056` `targetableIndices`); the port dropped it
      // along with the selection it had no way to make.
      let onlySelected = a.selectionCount > 0
      var p = Path()
      for i in 0..<a.count
      where a.arrived[i] == 0 && (!onlySelected || a.selected[i] != 0) {
        p.move(to: CGPoint(x: Double(a.x[i]), y: Double(a.y[i])))
        p.addLine(to: CGPoint(x: lines.to.x, y: lines.to.y))
      }
      ctx.stroke(p, with: .color(color(lines.color ?? ORANGE, 0.8)), lineWidth: hairline)
    }

    // A point a two-tap tool has already placed. Before the marker existed the
    // first tap of a measurement left nothing on the map at all.
    if let anchor = preview.anchorPoint {
      endpoint(anchor, into: &ctx, scale: scale, ink: ink)
    }

    if let ghost = preview.cursorGhost {
      // Only ever drawn while a touch is down -- there is no hover on iOS, and
      // a ghost parked at the last touch point is exactly the artefact to avoid.
      let s = ghost.size / scale
      let box = CGRect(x: ghost.at.x - s, y: ghost.at.y - s, width: s * 2, height: s * 2)
      switch ghost.kind {
      case .square, .eraser:
        ctx.stroke(Path(box), with: .color(color(ink)), lineWidth: hairline)
      case .frame:
        ctx.stroke(Path(box), with: .color(color(ink)), lineWidth: 3 / scale)
      case .target, .squiggle:
        ctx.stroke(Path(ellipseIn: box), with: .color(color(ORANGE)), lineWidth: 2 / scale)
      }
    }
  }
}

/// The diagnostic readout, on the platform's monospace.
///
/// Ports `app.ts:2223`. It stays monospaced deliberately: it is a diagnostic
/// drawn over the map, and it should look like one rather than like chrome.
///
/// The last three lines are the pedestrian literature's numbers, so "is this
/// realistic" has something to be checked against -- free walking should read
/// about 1.3 m/s, and a corridor past 2 persons/m² visibly slower.
struct DebugStats {
  var fps: Int
  var tps: Int
}

extension MapRenderer {
  static func debugLines(_ world: WalkyWorld, _ stats: DebugStats) -> [String] {
    let m = world.mouseWorld
    let walking = world.metrics.readout()
    return [
      "Pedestrians Alive: \(world.agents.count)",
      "Selected: \(world.agents.selectionCount)",
      "Walls: \(world.walls.count)",
      "Zoom level: \(world.viewport.zoomLevel) (scale \(String(format: "%.3f", world.viewport.scale)))",
      m.map { "X: \(Int(jsRound($0.x))) / Y: \(Int(jsRound($0.y)))" } ?? "X: - / Y: -",
      "FPS: \(stats.fps)",
      "TPS: \(world.running ? stats.tps : 0)",
      "Speed: \(String(format: "%.2f", walking.meanSpeedMps)) m/s",
      "Density: \(String(format: "%.1f", walking.meanDensity)) avg / "
        + "\(String(format: "%.1f", walking.maxDensity)) max /m2",
      "Throughput: \(String(format: "%.1f", walking.throughputPerSecond)) /s",
    ]
  }

  // MARK: - The measurement

  /// Walky's own walk, and Apple's beside it.
  ///
  /// Walky's is `ORANGE` at 2pt with round caps, which is not a choice so much
  /// as a recognition: it is the same object the goal route already is, and it
  /// should not arrive wearing a different coat. Apple's is `Accents.sky` --
  /// deliberately a fixed colour and *not* `settings.accent`, which the user can
  /// set to orange, at which point the two routes would become one line.
  static func drawMeasurement(_ m: DetourMeasurement, into ctx: inout GraphicsContext,
                              scale: Double, ink: RGB) {
    let sky = Accents.sky.color

    if let apple = m.apple, apple.count > 1 {
      ctx.stroke(path(apple), with: .color(color(sky)),
                 style: StrokeStyle(lineWidth: 2 / scale, lineCap: .round, lineJoin: .round))
      // The stubs from the taps to where Apple's route really begins and ends.
      // Dashed, because they are not walking -- they are the snap.
      if let first = apple.first, let last = apple.last {
        let stubs = StrokeStyle(lineWidth: 1.5 / scale, dash: [6 / scale, 6 / scale])
        ctx.stroke(path([m.a, first]), with: .color(color(sky, 0.7)), style: stubs)
        ctx.stroke(path([m.b, last]), with: .color(color(sky, 0.7)), style: stubs)
      }
    }

    ctx.stroke(path(m.walky), with: .color(color(ORANGE)),
               style: StrokeStyle(lineWidth: 2 / scale, lineCap: .round, lineJoin: .round))

    for end in [m.a, m.b] {
      endpoint(end, into: &ctx, scale: scale, ink: ink)
    }
  }

  /// One end of a measurement: a filled dot in the ink, ringed in orange.
  ///
  /// Shared with the preview on purpose. The first tap draws this and the
  /// finished measurement draws the same thing in the same place, so committing
  /// adds the route without moving the marks that were already there.
  static func endpoint(_ at: Point, into ctx: inout GraphicsContext,
                       scale: Double, ink: RGB) {
    let dot = 5 / scale
    let box = CGRect(x: at.x - dot, y: at.y - dot, width: dot * 2, height: dot * 2)
    ctx.fill(Path(ellipseIn: box), with: .color(color(ink)))
    ctx.stroke(Path(ellipseIn: box), with: .color(color(ORANGE)), lineWidth: 2 / scale)
  }

  private static func path(_ points: [Point]) -> Path {
    var p = Path()
    guard let first = points.first else { return p }
    p.move(to: CGPoint(x: first.x, y: first.y))
    for q in points.dropFirst() { p.addLine(to: CGPoint(x: q.x, y: q.y)) }
    return p
  }

  /// The measurement's two numbers, in the top-left corner.
  ///
  /// In the app's own voice rather than the debug readout's monospace: this is a
  /// result, not a diagnostic. It used to hang off the midpoint of the two taps,
  /// which sounds anchored and is not -- at any real zoom the midpoint leaves the
  /// canvas and the clamp drags the label back inside, so it ended up detached
  /// from its measurement *and* somewhere different every time. A fixed corner
  /// admits that, keeps the routes unobscured, and puts the numbers where the eye
  /// already knows to look.
  static func drawMeasurementLabel(_ m: DetourMeasurement, world: WalkyWorld,
                                   into ctx: inout GraphicsContext,
                                   size: CGSize, ink: RGB) {
    var lines = [walkyLine(m, world.settings.speed)]
    if let appleMetres = m.appleMetres, let ratio = m.ratio {
      // Named for what the route follows, not for whose API drew it: "pavements"
      // is the difference the ratio is about -- the mapped pedestrian network
      // against Walky's open geometry.
      lines.append("Pavements: \(metres(appleMetres)) · \(String(format: "%.2f", ratio))×")
    }

    let margin: CGFloat = 12
    // `MapCanvas` ignores the safe area, so `size` includes the status bar: this
    // is the top's mirror of the 110pt `drawDebug` reserves for the toolbar.
    let top: CGFloat = 60
    let padH: CGFloat = 8, padV: CGFloat = 6, gap: CGFloat = 3

    // One card around both lines, so resolve first and measure before drawing --
    // a per-line box would leave two ragged right edges in the corner.
    let resolved = lines.map { line -> GraphicsContext.ResolvedText in
      var text = ctx.resolve(Text(line).font(.system(size: 13, weight: .medium)))
      text.shading = .color(color(ink))
      return text
    }
    let measured = resolved.map { $0.measure(in: size) }
    let width = measured.map(\.width).max() ?? 0
    let height = measured.reduce(0) { $0 + $1.height }
      + gap * CGFloat(Swift.max(measured.count - 1, 0))

    let card = CGRect(x: margin, y: top, width: width + padH * 2, height: height + padV * 2)
    ctx.fill(Path(roundedRect: card, cornerRadius: 8),
             with: .color(color(world.settings.ground.background, 0.85)))

    var y = card.minY + padV
    for (text, box) in zip(resolved, measured) {
      ctx.draw(text, at: CGPoint(x: card.minX + padH, y: y), anchor: .topLeading)
      y += box.height + gap
    }
  }

  private static func walkyLine(_ m: DetourMeasurement, _ speedMps: Double) -> String {
    let seconds = speedMps > 0 ? m.walkyMetres / speedMps : 0
    return "\(metres(m.walkyMetres)) on foot · \(duration(seconds))"
  }

  private static func metres(_ m: Double) -> String {
    m < 1000 ? "\(Int(m.rounded())) m" : String(format: "%.2f km", m / 1000)
  }

  private static func duration(_ seconds: Double) -> String {
    let whole = Int(seconds.rounded())
    return whole < 60 ? "\(whole) s" : "\(whole / 60) min \(whole % 60) s"
  }

  /// Drawn in *screen* space, from a copy of the context taken before the world
  /// transform was applied -- `GraphicsContext` is a struct, so the copy keeps
  /// the untransformed CTM while still drawing to the same canvas.
  static func drawDebug(_ lines: [String], into ctx: inout GraphicsContext,
                        size: CGSize, ink: RGB) {
    let lineHeight: CGFloat = 15
    let margin: CGFloat = 12
    // Above the toolbar, which the readout must not hide behind.
    let bottom = size.height - 110
    var y = bottom - CGFloat(Swift.max(lines.count, 1) - 1) * lineHeight
    for line in lines {
      var text = ctx.resolve(Text(line)
        .font(.system(size: 11, weight: .regular, design: .monospaced)))
      text.shading = .color(color(ink, 0.75))
      ctx.draw(text, at: CGPoint(x: margin, y: y), anchor: .leading)
      y += lineHeight
    }
  }
}
