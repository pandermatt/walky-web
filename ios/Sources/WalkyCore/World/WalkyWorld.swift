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
  /// Walls, in placement order -- which for the doors among them is the order
  /// they emit in, and so the order the crowd's indices come out in.
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
    tools[.generator] = GeneratorTool()
  }

  public var canUndo: Bool { !undoStack.isEmpty }
  public var isEmpty: Bool { walls.isEmpty && agents.count == 0 }

  public func requestRender() {
    renderPending = true
    onRequestRender?()
  }

  /// Bumps both revisions and asks for a frame. Called by every mutation.
  func touch() {
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
    markGenerator: { [unowned self] at in self.toggleGeneratorAt(at) },
    selectPedestriansIn: { [unowned self] lasso in self.selectPedestriansIn(lasso) },
    selectionCount: { [unowned self] in self.agents.selectionCount },
    clearSelection: { [unowned self] in self.clearSelection() },
    standablePoint: { [unowned self] at in self.standable(at) },
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
    // Again here, and not only in the tool: the tool nudged against whatever
    // graph existed when the finger went down, and the rebuild above may have
    // just moved a wall under one of the two ends.
    let a = standable(a), b = standable(b)
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
    for wall in walls { wall.selected = false }
    var caught = 0
    for i in 0..<agents.count {
      let at = Point(Double(agents.x[i]), Double(agents.y[i]))
      if pointInPolygon(lasso, at) {
        agents.selected[i] = 1
        caught += 1
      }
    }
    // By its middle, not its corners: a lasso thrown round a door catches the
    // door, and one drawn past the edge of one does not take it along. Only
    // generators -- an ordinary wall has nothing a selection would do to it,
    // and `Wall.selected` is the field a generator now borrows.
    for door in generators where pointInPolygon(lasso, middle(door)) {
      door.selected = true
      caught += 1
    }
    touch()
    return caught
  }

  /// Drops the selection, and redraws -- the rings are on screen, so this is
  /// visible. `app.ts:433` reaches `touch()` the same way, through
  /// `afterSelectionChange`.
  public func clearSelection() {
    let anyDoor = walls.contains(where: \.selected)
    guard agents.selectionCount > 0 || anyDoor else { return }
    agents.clearSelection()
    for wall in walls { wall.selected = false }
    touch()
  }

  /// Turns the wall under a point into a generator, or back into a plain wall.
  ///
  /// Deliberately the same shape as `setGoalAt`: **any block can be a
  /// generator, exactly as any block can be a goal.** There is nothing to place
  /// and no footprint to find room for -- you draw a shape with the tools that
  /// draw shapes, and then say what it is. The tool used to drop a square block
  /// of its own, which was a second way to make walls that only the generator
  /// knew about.
  ///
  /// Tapping one that already is a generator takes it back off, because a
  /// marking tool with no un-marking gesture leaves undo as the only way out of
  /// a mistap.
  ///
  /// False when there is no wall there, so the tool can say so.
  @discardableResult
  public func toggleGeneratorAt(_ at: Point) -> Bool {
    guard let hit = pickWall(at) else { return false }
    checkpoint()
    if hit.generator != nil {
      hit.generator = nil
      // Its people are already walking and keep their goal: they came out of a
      // door that has closed behind them, which is what happens to people.
      onNotify?("No longer a generator.")
    } else {
      hit.generator = Generator(rate: settings.generatorRate)
      // A wall that is already a goal cannot also send people to itself.
      if hit.isGoal, let other = walls.first(where: { $0.isGoal && $0.id != hit.id }) {
        hit.generator?.goal = other.id
      } else if !hit.isGoal, let goal = walls.first(where: \.isGoal) {
        // Aimed at the goal that already exists, so one tap is enough on a map
        // that has one. `setGoalAt` is what aims it otherwise.
        hit.generator?.goal = goal.id
        hit.color = goal.color
      }
    }
    touch()
    return true
  }

  /// Any shape, as a generator, without a tap.
  ///
  /// What the room importer uses: a scanned doorway arrives as a polygon and
  /// has to become the thing people come out of in one step, with nobody there
  /// to tap it.
  @discardableResult
  public func addGeneratorShape(_ polygons: [[Point]], _ options: WallOptions? = nil) -> Bool {
    let usable = polygons.filter { $0.count >= 3 }
    if usable.isEmpty { return false }
    checkpoint()
    let wall = makeWall(usable, options ?? WallOptions(color: GENERATOR_GREY))
    wall.generator = Generator(rate: settings.generatorRate)
    walls.append(wall)
    removeAgentsUnder(wall)
    markNavDirty()
    touch()
    return true
  }

  /// Every wall that is a generator, in placement order -- which is the order
  /// they emit in, and so the order the arrivals hash is walked in.
  public var generators: [Wall] { walls.filter { $0.generator != nil } }

  public func clearGeneratorSelection() {
    guard walls.contains(where: \.selected) else { return }
    for wall in walls { wall.selected = false }
    touch()
  }

  /// The generator under a point, topmost first, or nil.
  public func pickGenerator(_ at: Point) -> Wall? {
    walls.last { $0.generator != nil && wallContains($0, at) }
  }

  /// The middle of a wall, for the questions that are about where it *is*
  /// rather than what it covers: which side of it the goal is on, and whether a
  /// lasso caught it.
  private func middle(_ wall: Wall) -> Point {
    var minX = Double.infinity, minY = Double.infinity
    var maxX = -Double.infinity, maxY = -Double.infinity
    for p in wall.hull {
      minX = jsMin(minX, p.x); maxX = jsMax(maxX, p.x)
      minY = jsMin(minY, p.y); maxY = jsMax(maxY, p.y)
    }
    return Point((minX + maxX) / 2, (minY + maxY) / 2)
  }

  /// Where a generator's people appear: clear of it, on the side its goal is on.
  ///
  /// A generator is a wall, so nobody can stand in it, and something has to decide
  /// which side of it they come out of. **The side the goal is on** is that
  /// something, and it is the only rule here that is a choice rather than
  /// arithmetic:
  ///
  /// - It is deterministic, which the whole model depends on.
  /// - It reads correctly in both the cases that matter. A doorway slab in a
  ///   room wall sends its people indoors, because that is where the exit is.
  ///   A door dropped on open ground faces the way its crowd is headed, so
  ///   people come out already pointing at where they are going.
  /// - It needs nothing the world does not already know: no inside/outside
  ///   test, no winding, and nothing stored that could go stale.
  ///
  /// The anchor is pushed out along that direction by the door's own extent
  /// plus the block's half-width, so the block it hands to `pedestrianBlock`
  /// starts where the door stops. `pedestrianBlock` then throws away whatever
  /// is still illegal, exactly as the brush does.
  func generatorMouth(_ source: Wall) -> Point {
    let here = middle(source)
    guard let goalId = source.generator?.goal, goalId >= 0,
          let goal = walls.first(where: { $0.id == goalId }) else { return here }
    let there = middle(goal)
    let dx = there.x - here.x, dy = there.y - here.y
    let span = jsHypot(dx, dy)
    // A door whose goal is itself, or dead centre of it: there is no direction
    // to leave in, and nobody comes out until it is aimed somewhere else.
    guard span > 0 else { return here }
    let ux = dx / span, uy = dy / span

    // How far the generator reaches in that direction, from its own hull.
    var reach = 0.0
    for p in source.hull {
      reach = jsMax(reach, (p.x - here.x) * ux + (p.y - here.y) * uy)
    }
    let clear = reach + Double(GENERATOR_CELLS) * settings.pedestrianRadius
    return Point(here.x + ux * clear, here.y + uy * clear)
  }

  /// Lets the doors out.
  ///
  /// Ports `app.ts:1669-1696`. Driven from `stepOnce`, so the doors and the
  /// crowd share one clock: on a machine too slow for even the clamped substeps
  /// they slow down together, rather than the doors running on ahead into a
  /// room nobody can walk across.
  ///
  /// A door with no goal is skipped. It has nowhere to send anybody, and since
  /// its pedestrians only leave the map by arriving, what it would make is a
  /// pile that never goes away.
  private func emit() {
    for wall in walls {
      guard let door = wall.generator, door.goal >= 0 else { continue }

      if door.wait <= 0 {
        // Hashed on its middle, so the same generator on the same map replays
        // the same demand -- the invariant the crowd's traits already keep.
        let burst = burstAt(middle(wall), door.beat, door.rate)
        door.owed = jsMin(door.owed + burst.size, QUEUE_MAX)
        door.wait = burst.gap
        door.beat += 1
      }
      door.wait -= 1

      // Nothing waiting, and nothing to ask: `pedestrianBlock` rebuilds the
      // brush's spatial hash, which is not a thing to do once a frame per
      // idle door.
      if door.owed < 1 { continue }

      // The brush's own legality test over the block just outside it: not
      // inside a wall -- this one included -- and not on top of somebody
      // already standing there. It already refuses two spots within a diameter
      // of each other, so filling every one at once is legal by construction.
      // Empty means the doorway is blocked or full, and the queue waits.
      let colour = walls.first { $0.id == door.goal }?.color ?? wall.color
      for spot in pedestrianBlock(generatorMouth(wall), GENERATOR_CELLS) {
        if door.owed < 1 { break }
        _ = agents.addSpawned(spot, door.goal, colour)
        door.owed -= 1
      }
    }
  }

  /// Marks the wall under a point as a goal; false when there is no wall there.
  @discardableResult
  public func setGoalAt(_ at: Point) -> Bool {
    guard let hit = pickWall(at) else { return false }
    checkpoint()
    hit.isGoal = true
    // With a selection the goal applies to it alone; with nothing selected it
    // applies to everyone, as `Map.setGoalForSelectedPedestrians` did.
    let onlySelected = agents.selectionCount > 0 || walls.contains(where: \.selected)
    for i in 0..<agents.count {
      if onlySelected && agents.selected[i] == 0 { continue }
      agents.setGoal(i, hit.id, hit.color)
    }
    // A door is in "everyone" as squarely as a pedestrian is, and pinning one
    // matters more: aiming a pedestrian sends one person, aiming a door sends
    // everybody it will ever let out.
    for wall in generators where wall.id != hit.id {
      if onlySelected && !wall.selected { continue }
      wall.generator?.goal = hit.id
      // The door wears its goal's colour, as its people do: a glance says where
      // the crowd coming out of it is headed.
      wall.color = hit.color
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
    // A door heading somewhere counts as somebody heading there, or its goal
    // would be un-marked the moment the last of its people arrived.
    for wall in generators where (wall.generator?.goal ?? -1) >= 0 {
      wanted.insert(wall.generator!.goal)
    }
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

  /// The nearest place a pedestrian could stand.
  ///
  /// A tap on a roof is a reasonable thing to do -- you point at the building
  /// you want the walk measured around -- and answering it with "No way through
  /// from there" blames the user for the tool's literalism. So a point inside a
  /// building is answered just outside it, on the same clearance ring the
  /// visibility graph puts its own nodes on: `NODE_MARGIN` beyond the outline
  /// already inflated by the pedestrian's radius. That is not an approximation
  /// of where somebody could stand, it is exactly where the router expects to
  /// find them.
  ///
  /// The point leaves by the nearest edge, and by the direction it travelled to
  /// get there, so a tap a little way inside a wall comes out of the side it
  /// went in.
  ///
  /// Repeated a bounded number of times, because obstacles overlap: stepping
  /// out of one convex part can land inside its neighbour, and the answer to
  /// that is to step out of that too. Bounded rather than looped -- a point
  /// sealed inside a courtyard has no answer at all, and `measure` is the one
  /// that gets to say so.
  public func standable(_ p: Point) -> Point {
    // The obstacle hulls come off the graph, so there has to be one.
    ensureNav()
    var at = p
    for _ in 0..<8 {
      guard let ob = nav.obstacles.first(where: { inside($0, at) }) else { return at }
      at = justOutside(ob.hull, at)
    }
    return at
  }

  private func inside(_ ob: Obstacle, _ p: Point) -> Bool {
    if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
      || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { return false }
    return pointInPolygon(ob.hull, p)
  }

  /// The nearest point on a ring, carried a margin past it.
  private func justOutside(_ hull: [Point], _ p: Point) -> Point {
    var best = p
    var bestD = Double.infinity
    for i in 0..<hull.count {
      let q = closestPointOnSegment(hull[i], hull[(i + 1) % hull.count], p)
      let d = distance(p, q)
      if d < bestD { bestD = d; best = q }
    }
    let dx = best.x - p.x, dy = best.y - p.y
    let len = jsHypot(dx, dy)
    // Dead centre of a ring, or exactly on its boundary: there is no direction
    // to travel in, so pick one. Any is as good as any other.
    guard len > 0 else { return Point(jsRound(p.x + NODE_MARGIN), jsRound(p.y)) }
    let out = (len + NODE_MARGIN) / len
    return Point(jsRound(p.x + dx * out), jsRound(p.y + dy * out))
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
  func markNavDirty() {
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
    // The generators come along inside the walls -- `Wall.shallowCopy` copies
    // the `Generator`, queue and beat and all.
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
    // Back to the top of each door's schedule, not just to an empty queue:
    // Reset means the same demand again, and `Arrivals` is a hash of the beat.
    for wall in generators {
      wall.generator?.owed = 0
      wall.generator?.beat = 0
      wall.generator?.wait = 0
    }
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
    viewport.homeLevel = 0
    measurement = nil
  }

  public func resetZoom() {
    let bounds = contentBounds()
    raiseZoomCeiling(for: bounds)
    viewport.reset(bounds)
    requestRender()
  }

  /// Frame an imported map, and make that framing home.
  ///
  /// `resetZoom` is for a map somebody drew: it never zooms in past the stop
  /// the app opens at, because that is where the drawing was authored. An
  /// import has a real size instead of an authored one, and a scanned room is
  /// smaller than the screen -- 4m at life size wants two notches *in*, and
  /// opening at zero would leave the room in a box in the middle of the display
  /// with the crowd too small to watch.
  ///
  /// So this frames the content at whatever notch fits, in or out, and tells
  /// the viewport that is where "reset zoom" should come back to. A drawn map
  /// never calls it and is untouched.
  public func frameImport() {
    let bounds = contentBounds()
    raiseZoomCeiling(for: bounds)
    guard let bounds else {
      viewport.reset(nil)
      requestRender()
      return
    }
    viewport.homeLevel = 0
    viewport.fit(bounds)
    viewport.homeLevel = viewport.zoomLevel
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
  func raiseZoomCeiling(for bounds: Bounds?) {
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
    // Before the step, so somebody who arrives this tick walks this tick.
    emit()
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
