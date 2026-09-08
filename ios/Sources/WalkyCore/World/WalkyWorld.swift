import Foundation
import WalkyGeo

/// The map as it stands, before the edit about to change it.
///
/// Shallow copies, matching `app.ts:1214`. See `Wall.shallowCopy()` for why
/// that is not the same as `walls.map { $0 }` in Swift.
public struct MapSnapshot {
  public var walls: [Wall]
  public var agents: AgentsSnapshot
}

/// How deep undo goes. Oldest goes first once full, so the depth is a window on
/// the recent past rather than a limit on how long you may keep drawing.
public let UNDO_DEPTH = 40

/// The crowd size worth mentioning, past which `CrowdBanner` appears.
///
/// Measured rather than guessed: on a fast Mac in a release build a walking
/// crowd costs about 2.8 ms/tick at 1,000 and 5.7 ms at 2,000, against a 16.7 ms
/// frame. Two thousand is where a third of the budget has gone, which on a phone
/// -- slower, and thermally limited -- is where it stops being free. See
/// `StepCostBench`.
public let CROWD_WARN_AT = 2_000

/// The port of `App`, minus everything that needs a screen.
///
/// Holds the map, the crowd, the camera and the tools; runs a tick; takes and
/// puts back undo checkpoints. Deliberately **not** `@Observable`: `Agents.x` is
/// an array mutated sixty times a second, and reachable through an observed
/// property it would fire change tracking on every write. The view layer watches
/// a separate one-integer `Redraw` instead, bumped by `requestRender`.
@MainActor
public final class WalkyWorld: PointerHost {
  public var walls: [Wall] = []
  public let agents = Agents()
  public let nav = Navigation()
  public let hash = SpatialHash()
  /// The brush's own, so a drag never touches the crowd's. See `pedestrianBlock`.
  private let brushHash = SpatialHash()
  public let metrics = Metrics()
  public let clock = Clock()
  public let settings = Settings()
  public var viewport = Viewport()

  /// Where world `(0, 0)` sits on the earth, once a real place has been
  /// imported. `nil` on a blank map, which is the default and the only state
  /// the web app has.
  public var geoAnchor: GeoAnchor?

  /// The measurement drawn on the map, if one has been taken.
  ///
  /// It lives here rather than in `MeasureTool` because `preview()` is only
  /// called for the *armed* tool: held in the tool, a measurement would vanish
  /// the moment you disarmed it to draw a wall -- which is precisely the moment
  /// it is needed.
  public private(set) var measurement: DetourMeasurement?
  private let measuring = MeasuringGraph()

  public var running = false
  public var mouseWorld: Point?
  /// Bumped whenever the map changes, and whenever the crowd does. Split
  /// because a renderer can cache wall geometry against the first and must not
  /// against the second -- conflating them cost the web app ~800ms/frame.
  public private(set) var worldRevision = 0
  public private(set) var agentRevision = 0

  private var undoStack: [MapSnapshot] = []
  private var navDirty = true
  /// Whether any graph has ever landed. Until one has there is nothing to walk
  /// on, so the first build is taken synchronously however slow it is; every
  /// one after that is deferred, because the crowd has a graph already.
  private var navBuilt = false
  /// The rebuild in flight, if any. One at a time: a second would be answering
  /// the same walls.
  private var navBuild: Task<Void, Never>?
  /// Bumped by every wall edit, so a build that finishes late can tell it is
  /// stale. `Basemap` owns its task the same way, for the same reason.
  ///
  /// Its own counter rather than `worldRevision`, which also moves when only
  /// the crowd changes: a brush drag would then cancel the in-flight rebuild on
  /// every point of the stroke and it would never land.
  private var navGeneration = 0
  /// So the "pick a tool" nudge is a nudge and not a drumbeat.
  private var suggestedATool = false
  /// Ticks stepped since launch, so a frame can report how many it just ran.
  public private(set) var simTicks = 0
  private var renderPending = false

  /// Anything the host wants to know: a render is wanted, or a message shown.
  public var onRequestRender: (() -> Void)?
  public var onNotify: ((String) -> Void)?
  /// A tap on the map with nothing armed. Set by the app layer, which is the
  /// only part that knows the controls are hidden; the world just reports the
  /// gesture, exactly as it does for `pannedWithoutTool`.
  public var onIdleTap: (() -> Void)?
  public var onToolChanged: ((ToolId?) -> Void)?
  /// Asks the host for Apple's walking route. Nil where MapKit is not available
  /// -- and it never is inside this package, which carries no framework.
  public var onDetourRequested: ((Point, Point) -> Void)?

  private var tools: [ToolId: any Tool] = [:]
  public private(set) var activeTool: ToolId?
  public var tool: (any Tool)? { activeTool.flatMap { tools[$0] } }

  public init() {
    settings.restore()
    tools[.wall] = WallTool()
    tools[.rectangle] = RectangleTool()
    tools[.border] = BorderTool()
    tools[.pedestrian] = PedestrianTool()
    tools[.goal] = GoalTool()
    tools[.measure] = MeasureTool()
  }

  public var canUndo: Bool { !undoStack.isEmpty }
  public var isEmpty: Bool { walls.isEmpty && agents.count == 0 }

  public func requestRender() {
    renderPending = true
    onRequestRender?()
  }

  /// Bumps both revisions and asks for a frame. Called by every mutation.
  private func touch() {
    worldRevision &+= 1
    agentRevision &+= 1
    requestRender()
  }

  public func setTool(_ id: ToolId?) {
    tool?.cancel()
    activeTool = id
    mouseWorld = nil
    onToolChanged?(id)
    requestRender()
  }

  // MARK: - The tool's view of the world

  public lazy var toolContext: ToolContext = ToolContext(
    addWall: { [unowned self] polygon, options in self.addWallShape([polygon], options) },
    addWallShape: { [unowned self] polygons, options in self.addWallShape(polygons, options) },
    settings: { [unowned self] in SettingsSnapshot(self.settings) },
    pedestrianBlock: { [unowned self] at, cells in self.pedestrianBlock(at, cells) },
    addPedestrians: { [unowned self] at in self.addPedestrians(at) },
    setGoalAt: { [unowned self] at in self.setGoalAt(at) },
    selectPedestriansIn: { [unowned self] lasso in self.selectPedestriansIn(lasso) },
    selectionCount: { [unowned self] in self.agents.selectionCount },
    clearSelection: { [unowned self] in self.clearSelection() },
    deactivateTool: { [unowned self] in self.setTool(nil) },
    notify: { [unowned self] message in self.onNotify?(message) },
    requestRender: { [unowned self] in self.requestRender() },
    colorAt: { [unowned self] at in self.pickWall(at)?.color },
    worldPerPixel: { [unowned self] in self.viewport.worldPerPixel },
    measure: { [unowned self] a, b in self.measure(a, b) })

  // MARK: - Edits

  @discardableResult
  public func addWallShape(_ polygons: [[Point]], _ options: WallOptions?) -> Bool {
    let usable = polygons.filter { $0.count >= 3 }
    if usable.isEmpty { return false }

    checkpoint()
    let wall = makeWall(usable, options ?? WallOptions())
    walls.append(wall)
    removeAgentsUnder(wall)
    markNavDirty()
    touch()
    return true
  }

  /// Many walls as one edit.
  ///
  /// `addWallShape` takes a checkpoint per call and a checkpoint copies every
  /// wall in the world, so importing 150 buildings through it is O(n^2) copies
  /// and buries the 40-deep undo stack under a single gesture. An import is one
  /// edit: one checkpoint, one revision bump, one navigation rebuild.
  @discardableResult
  public func addWalls(_ shapes: [[[Point]]], _ options: WallOptions? = nil) -> Int {
    let usable = shapes.map { $0.filter { $0.count >= 3 } }.filter { !$0.isEmpty }
    if usable.isEmpty { return 0 }

    checkpoint()
    for polygons in usable {
      let wall = makeWall(polygons, options ?? WallOptions())
      walls.append(wall)
      // Skipped entirely on the empty map an import usually lands on; this is
      // O(agents) per wall and there is no point paying it for nobody.
      if agents.count > 0 { removeAgentsUnder(wall) }
    }
    markNavDirty()
    touch()
    return usable.count
  }

  // MARK: - Measuring

  /// Walky's own walk from `a` to `b`, and then a request for Apple's.
  ///
  /// `requestRender()` rather than `touch()`: a measurement moves no walls, and
  /// `touch()` would bump `worldRevision` and throw away every cached wall and
  /// hull path in the renderer for nothing.
  public func measure(_ a: Point, _ b: Point) {
    // Now, not later: a measurement against a stale map is a wrong answer
    // rather than a late one.
    rebuildNavNow()
    guard let taken = measuring.measure(from: a, to: b, walls: walls,
                                        radius: settings.pedestrianRadius,
                                        revision: worldRevision,
                                        scale: geoAnchor?.scale ?? 1) else {
      measurement = nil
      onNotify?("No way through from there.")
      requestRender()
      return
    }
    measurement = taken
    requestRender()
    onDetourRequested?(a, b)
  }

  /// Apple's half, once it arrives. Dropped if the measurement has moved on --
  /// a reply to a question nobody is asking any more.
  public func setAppleRoute(_ a: Point, _ b: Point, _ path: [Point], _ metres: Double) {
    guard var current = measurement, current.a == a, current.b == b else { return }
    current.apple = path
    current.appleMetres = metres
    measurement = current
    requestRender()
  }

  public func clearMeasurement() {
    guard measurement != nil else { return }
    measurement = nil
    requestRender()
  }

  /// Pedestrians standing where a wall was just drawn are removed.
  private func removeAgentsUnder(_ wall: Wall) {
    var i = agents.count - 1
    while i >= 0 {
      if wallContains(wall, Point(Double(agents.x[i]), Double(agents.y[i]))) {
        agents.removeAt(i)
      }
      i -= 1
    }
  }

  public func addPedestrians(_ at: Point) {
    let spots = pedestrianBlock(at, nil)
    if spots.isEmpty { return }
    checkpoint()
    for p in spots { agents.add(p, randomBrightColor()) }
    touch()
  }

  /// Says, once, that a tool has to be picked.
  ///
  /// Only on a map with nothing on it: dragging across a large map you have
  /// already drawn is ordinary navigation, and saying anything then would be
  /// nagging. This is `isEmpty`'s first reader.
  ///
  /// The flag is not politeness. `PointerRouter.moved` fires dozens of times in
  /// one drag, so without it a single pan would push dozens of notices.
  public func pannedWithoutTool() {
    guard isEmpty, !suggestedATool else { return }
    suggestedATool = true
    onNotify?("Nothing here yet — pick a tool below to start drawing.")
  }

  /// A tap that went nowhere, with no tool armed.
  ///
  /// No policy here at all -- unlike `pannedWithoutTool` above, which owns the
  /// "only on an empty map, only once" rule because only the world can answer
  /// it. Whether an idle tap means anything depends on whether the controls are
  /// hidden, and that is the app layer's business.
  public func tappedWithoutTool() {
    onIdleTap?()
  }

  /// Selects every pedestrian inside a lasso outline, and answers how many.
  ///
  /// Ports `app.ts:419-433` minus its generator half, which has no counterpart:
  /// `ToolId` has no `generator` in v1. Replaces the selection rather than
  /// extending it -- extend mode is keyed on `shiftKey`, which `PointerInfo`
  /// says is always false on a touchscreen.
  ///
  /// Not a checkpoint. Selecting decides *who*, and the edit that follows --
  /// `setGoalAt` -- takes the checkpoint, so undo steps back over the whole
  /// gesture rather than over the half of it that changed nothing.
  @discardableResult
  public func selectPedestriansIn(_ lasso: [Point]) -> Int {
    agents.clearSelection()
    var caught = 0
    for i in 0..<agents.count {
      let at = Point(Double(agents.x[i]), Double(agents.y[i]))
      if pointInPolygon(lasso, at) {
        agents.selected[i] = 1
        caught += 1
      }
    }
    touch()
    return caught
  }

  /// Drops the selection, and redraws -- the rings are on screen, so this is
  /// visible. `app.ts:433` reaches `touch()` the same way, through
  /// `afterSelectionChange`.
  public func clearSelection() {
    guard agents.selectionCount > 0 else { return }
    agents.clearSelection()
    touch()
  }

  /// Marks the wall under a point as a goal; false when there is no wall there.
  @discardableResult
  public func setGoalAt(_ at: Point) -> Bool {
    guard let hit = pickWall(at) else { return false }
    checkpoint()
    hit.isGoal = true
    // With a selection the goal applies to it alone; with nothing selected it
    // applies to everyone, as `Map.setGoalForSelectedPedestrians` did.
    let onlySelected = agents.selectionCount > 0
    for i in 0..<agents.count {
      if onlySelected && agents.selected[i] == 0 { continue }
      agents.setGoal(i, hit.id, hit.color)
    }
    pruneGoals(hit.id)
    markNavDirty()
    // The goal's routing field comes from this. Deferred once a graph exists,
    // so the route lines appear a beat after the tap on a big map rather than
    // the tap freezing for two seconds.
    ensureNav()
    touch()
    return true
  }

  /// Drops the goal flag from walls nobody is walking to.
  ///
  /// Several walls can be goals at once, but a goal is not free: `Navigation`
  /// runs a Dijkstra over the whole graph per goal wall on every rebuild. So a
  /// wall stays marked only while it is the one just picked, or while some
  /// pedestrian still has it. Arrived pedestrians count -- a crowd standing at
  /// its goal is still standing at a goal.
  private func pruneGoals(_ justMarked: Int) {
    var wanted: Set<Int> = [justMarked]
    for i in 0..<agents.count where agents.goal[i] >= 0 { wanted.insert(Int(agents.goal[i])) }
    for w in walls { w.isGoal = wanted.contains(w.id) }
  }

  /// The wall under a point, or nil. Topmost wins, as tapping expects.
  public func pickWall(_ at: Point) -> Wall? {
    var i = walls.count - 1
    while i >= 0 {
      if wallContains(walls[i], at) { return walls[i] }
      i -= 1
    }
    return nil
  }

  private func isBlocked(_ p: Point) -> Bool {
    for ob in nav.obstacles {
      if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
        || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { continue }
      if pointInPolygon(ob.hull, p) { return true }
    }
    return false
  }

  /// The legal spots in an n x n brush block centred on `at`.
  ///
  /// Ports `Map.isThisALegalPedestrianCoordinate`: a pedestrian may not be
  /// dropped where it would touch a wall or overlap another. Used both to place
  /// and to draw the ghost, so what you see is what you get.
  ///
  /// Not a pure query despite reading like one: it rebuilds the navigation if
  /// the map has changed, and rebuilds `brushHash` every call.
  ///
  /// `brushHash`, and not the simulation's `hash`, since a brush drag runs
  /// between ticks: sharing one meant a stroke rebuilt the crowd's hash at the
  /// brush's cell size, which the next tick then rebuilt again at its own.
  /// Two rebuilds a frame for one answer, and the two would have been on
  /// different threads the moment the tick moved off the main one.
  public func pedestrianBlock(_ at: Point, _ cells: Int?) -> [Point] {
    // `isBlocked` reads the graph's obstacles, so there has to be one.
    ensureNav()
    let r = settings.pedestrianRadius
    let n = Swift.max(1, cells ?? Int(settings.brushSize))
    // Shoulder to shoulder, and left to sort themselves out: a crowd opens out
    // to the room it wants within a second of being let go, so painting it
    // packed is both the better tool and the better demonstration.
    let pitch = 2 * r
    let half = (Double(n - 1) * pitch) / 2
    let minGap = 2 * r

    // Existing agents are found through the hash; agents chosen earlier in this
    // same block are checked directly, since the hash predates them.
    brushHash.build(agents.x, agents.y, agents.count, jsMax(1, minGap))

    var chosen: [Point] = []
    for i in 0..<n {
      for j in 0..<n {
        let p = Point(jsRound(at.x - half + Double(i) * pitch),
                      jsRound(at.y - half + Double(j) * pitch))
        if isBlocked(p) { continue }
        if brushHash.query(p.x, p.y, minGap, -1, agents.x, agents.y) > 0 { continue }
        if chosen.contains(where: { jsHypot($0.x - p.x, $0.y - p.y) < minGap }) { continue }
        chosen.append(p)
      }
    }
    return chosen
  }

  /// Start a rebuild if one is due, and carry on.
  ///
  /// The rebuild is `n^2.5` in wall corners -- 2.1 seconds on a forced 600m
  /// import -- and it used to run right here, on the main actor, on every wall
  /// edit. So the app froze for two seconds whenever anybody drew a line.
  ///
  /// Now it is a pure function (`Navigation.build`) run off the actor while the
  /// crowd keeps walking on the graph it already has. Two consequences worth
  /// knowing:
  ///
  /// **Edits coalesce.** Drawing ten walls used to be ten synchronous rebuilds
  /// in a row; it is now one, because `navDirty` is still set when the build
  /// starts and only cleared by the build that answers the *current* walls.
  ///
  /// **The geometry is briefly stale.** For up to one rebuild, `insideAnyWall`
  /// reads the old graph's obstacles, so a pedestrian can walk through a wall
  /// that is already on screen. Bounded by one rebuild, and partly covered
  /// already because `addWalls` clears the agents under a new wall.
  /// The graph no longer describes the map. Always both, never one.
  private func markNavDirty() {
    navDirty = true
    navGeneration &+= 1
  }

  /// A graph to walk on, whatever it takes.
  ///
  /// The first one is built here and now: there is no old graph to carry on
  /// with, and a crowd standing still until a background task lands is not
  /// "keeping the routes it has". After that, edits are deferred.
  private func ensureNav() {
    if navBuilt { rebuildNavIfNeeded() } else { rebuildNavNow() }
  }

  private func rebuildNavIfNeeded() {
    guard navDirty, navBuild == nil else { return }
    let generation = navGeneration
    let snapshot = walls.map(WallSnapshot.init)
    let radius = settings.pedestrianRadius
    navBuild = Task { [weak self] in
      let built = await Task.detached(priority: .userInitiated) {
        Navigation.build(snapshot, radius)
      }.value
      guard let self, !Task.isCancelled else { return }
      self.navBuild = nil
      // Walls moved on while this was in flight: it answers a question nobody
      // is asking, and `navDirty` is still set, so the next call starts again.
      guard generation == self.navGeneration else {
        self.rebuildNavIfNeeded()
        return
      }
      self.nav.install(built)
      self.navDirty = false
      self.navBuilt = true
      self.requestRender()
    }
  }

  /// Build and install now, blocking whoever asked.
  ///
  /// For the callers that cannot take a late answer: a measurement against a
  /// stale map is wrong rather than merely behind, and the tests construct a
  /// world and assert on it in the same breath. Everything else schedules.
  public func rebuildNavNow() {
    guard navDirty else { return }
    navBuild?.cancel()
    navBuild = nil
    nav.rebuild(walls, settings.pedestrianRadius)
    navDirty = false
    navBuilt = true
  }

  /// Schedule a rebuild and wait for it. What the importer uses, so its
  /// "Building the navigation graph..." label covers a build that is genuinely
  /// off this actor rather than a blocking call under a caption.
  public func navReady() async {
    rebuildNavIfNeeded()
    await navBuild?.value
  }

  // MARK: - Undo

  /// Remembers the map before the edit about to change it.
  ///
  /// Taken by the edits themselves and only once something is definitely going
  /// to happen: a brush stroke that lands no pedestrian changes nothing, and an
  /// undo step that undoes nothing is worse than none.
  ///
  /// Not checkpointed: the selection, which is a way of looking at the map
  /// rather than part of it; the camera; and reset-pedestrians, which puts
  /// everyone back on an origin it never throws away and so undoes itself.
  public func checkpoint() {
    undoStack.append(MapSnapshot(walls: walls.map { $0.shallowCopy() },
                                 agents: agents.snapshot()))
    if undoStack.count > UNDO_DEPTH { undoStack.removeFirst() }
  }

  /// Puts the last edit back.
  ///
  /// The map only -- undoing a wall is not a reason to stop the simulation.
  /// Pedestrians do go back to where they stood when the edit was made.
  public func undo() {
    guard let previous = undoStack.popLast() else { return }
    walls = previous.walls
    agents.restore(previous.agents)
    markNavDirty()
    // Whatever is half-drawn was drawn on a map that no longer exists.
    tool?.cancel()
    touch()
  }

  // MARK: - Actions

  public func play(_ on: Bool) {
    running = on
    clock.reset()
    requestRender()
  }

  public func resetPedestrians() {
    agents.removeSpawned()
    var goalColors: [Int32: RGB] = [:]
    for w in walls where w.isGoal { goalColors[Int32(w.id)] = w.color }
    agents.resetPositions(goalColors, { randomBrightColor() })
    metrics.reset()
    touch()
  }

  public func clearAll() {
    walls = []
    agents.clear()
    undoStack = []
    markNavDirty()
    running = false
    metrics.reset()
    clock.reset()
    touch()
    // A cleared map is a blank one again: no anchor, and the original's zoom
    // stops back, so the camera cannot wander out into empty space.
    geoAnchor = nil
    viewport.zoomLevelMax = ZOOM_LEVEL_MAX
    measurement = nil
  }

  public func resetZoom() {
    let bounds = contentBounds()
    raiseZoomCeiling(for: bounds)
    viewport.reset(bounds)
    requestRender()
  }

  /// Let the camera out far enough to see what is actually on the map.
  ///
  /// `Viewport.zoomLevelMax` is 20 notches, which came from `ZoomMouseListener`
  /// when the whole world was a few hundred pixels of freehand drawing. An
  /// imported neighbourhood is not that world: 380m at 56px to the metre is
  /// 21,280 units, which `fit` wants 45 notches for and used to be clamped to
  /// 20 -- leaving the map about eight screens wide with no way to see the rest
  /// of it. The ceiling was per-map by design and **nothing outside the tests
  /// ever raised it**, so the app has never been able to frame an import.
  ///
  /// Raised from the content rather than from the import, so a hand-drawn map
  /// that grew large gets the same courtesy. Never lowered below the original's
  /// stop, so the 2016 camera is exactly itself on every map that fits.
  private func raiseZoomCeiling(for bounds: Bounds?) {
    guard let bounds else { return }
    let across = jsMax(1, jsMax(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY))
    let onScreen = jsMax(1, jsMin(viewport.width, viewport.height))
    // The notches that would fit it, plus a few so it can be pushed out past a
    // snug fit -- `fit` rounds to a whole stop and may land just inside.
    let wanted = jsLog(across / onScreen) / jsLog(ZOOM_FACTOR) + 4
    viewport.zoomLevelMax = jsMax(ZOOM_LEVEL_MAX, wanted)
  }

  /// What reset-zoom aims at: everything drawn, in world units.
  public func contentBounds() -> Bounds? {
    var minX = Double.infinity, minY = Double.infinity
    var maxX = -Double.infinity, maxY = -Double.infinity
    func add(_ x: Double, _ y: Double) {
      if x < minX { minX = x }
      if y < minY { minY = y }
      if x > maxX { maxX = x }
      if y > maxY { maxY = y }
    }
    for wall in walls {
      for polygon in wall.polygons { for p in polygon { add(p.x, p.y) } }
    }
    for i in 0..<agents.count { add(Double(agents.x[i]), Double(agents.y[i])) }
    return minX.isFinite ? Bounds(minX: minX, minY: minY, maxX: maxX, maxY: maxY) : nil
  }

  // MARK: - The loop

  /// One tick, in the order `app.ts:1734` takes it. Every step of that order is
  /// load-bearing and documented there; the two that move are `metrics.sample`,
  /// which must see `justArrived` before anything shuffles slots, and the
  /// recost, which reads the hash `agents.step` just built.
  public func stepOnce() {
    ensureNav()
    agents.step(nav, hash, pxPerTickFromMps(settings.speed),
                settings.pedestrianRadius, settings.personalSpace)
    metrics.sample(agents, settings.pedestrianRadius)
    simTicks += 1
    if simTicks % RECOST_TICKS == 0 {
      nav.recost(hash, agents.x, agents.y, agents.count)
    }
    agents.removeArrivedSpawned()
  }

  /// Advances simulated time by however much wall-clock time has passed, and
  /// reports whether anything needs drawing.
  @discardableResult
  public func advance(_ nowMs: Double) -> Bool {
    if running {
      let steps = clock.advance(nowMs)
      for _ in 0..<steps { stepOnce() }
      if steps > 0 { agentRevision &+= 1; renderPending = true }
    } else {
      // Time spent paused is not owed: resuming must not open on a burst of
      // catch-up steps.
      clock.reset()
    }
    defer { renderPending = false }
    return renderPending
  }

  /// Makes the navigation current. The renderer needs it for the dashed hulls
  /// and the goal routes, and `nav` is only rebuilt lazily.
  /// Brings the navigation up to date before a frame is drawn.
  ///
  /// Called from the display link, *not* from the renderer. It used to be the
  /// first line of `MapRenderer.draw`, which meant a draw could rebuild the
  /// visibility graph and run a Dijkstra per goal -- the render path mutating
  /// the model, inside a `Canvas` closure. It also ran on every frame whether
  /// or not anything read the navigation, and route lines are off by default.
  ///
  /// The invariant is unchanged because `AppModel.tick` is the only thing that
  /// bumps `redraw.version`: the navigation is still fresh whenever a frame is
  /// drawn, it is simply made fresh a moment earlier and by the model's own
  /// update rather than by the drawing of it.
  public func prepareForRender() { rebuildNavIfNeeded() }
}
