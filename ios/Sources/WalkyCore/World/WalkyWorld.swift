import Foundation

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

  public var running = false
  public var mouseWorld: Point?
  /// Bumped whenever the map changes, and whenever the crowd does. Split
  /// because a renderer can cache wall geometry against the first and must not
  /// against the second -- conflating them cost the web app ~800ms/frame.
  public private(set) var worldRevision = 0
  public private(set) var agentRevision = 0

  private var undoStack: [MapSnapshot] = []
  private var navDirty = true
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
    worldPerPixel: { [unowned self] in self.viewport.worldPerPixel })

  // MARK: - Edits

  @discardableResult
  public func addWallShape(_ polygons: [[Point]], _ options: WallOptions?) -> Bool {
    let usable = polygons.filter { $0.count >= 3 }
    if usable.isEmpty { return false }

    checkpoint()
    let wall = makeWall(usable, options ?? WallOptions())
    walls.append(wall)
    removeAgentsUnder(wall)
    navDirty = true
    touch()
    return true
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
    navDirty = true
    // Before the render: it draws the route of every agent to its own goal,
    // which reads the field this rebuild produces.
    rebuildNavIfNeeded()
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
    rebuildNavIfNeeded()
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

  private func rebuildNavIfNeeded() {
    if !navDirty { return }
    nav.rebuild(walls, settings.pedestrianRadius)
    navDirty = false
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
    navDirty = true
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
    navDirty = true
    running = false
    metrics.reset()
    clock.reset()
    touch()
  }

  public func resetZoom() {
    viewport.reset(contentBounds())
    requestRender()
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
    rebuildNavIfNeeded()
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
