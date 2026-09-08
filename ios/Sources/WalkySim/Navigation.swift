import Foundation

/// Sub-pixel: how close counts as "already standing on this node".
private let ON_NODE_EPSILON: Double = 0.5

/// How often the routing fields notice the crowd: every two seconds, one goal
/// per recost, round-robin.
public let RECOST_TICKS = 120

/// How far apart an edge is sampled for the people standing along it.
private let SAMPLE_SPACING: Double = 100
private let SAMPLES_MAX: Double = 8

/// How much of a recost's measurement lands on the stored slowdown at once.
private let SLOW_EMA: Double = 0.5

public struct Waypoint {
  public var point: Point
  /// Remaining distance to the goal through this waypoint -- the original's
  /// `distanceToGoal()`, which decided who outranks whom in a crowd, except the
  /// original re-walked its whole path to get it.
  public var cost: Double
  /// Index of the graph node aimed at, or -1 when heading straight to the goal.
  public var node: Int
}

/// The inverted form of the original's navigation. Ports `src/sim/navigation.ts`.
///
/// `IntelligentPedestrian.generateFastestPath()` rebuilt the whole visibility
/// graph and ran Dijkstra once per pedestrian per step. Here the graph is built
/// once per map edit and Dijkstra runs once per *goal*.
public final class Navigation {
  private var graph = VisibilityGraph(
    nodes: [], nodeWall: [], nodePart: [], nodeRingIndex: [], ringLength: [],
    csr: CsrGraph(nodeCount: 0, offsets: [0], targets: [], weights: []),
    blockers: Blockers(obstacles: [], shells: [], groups: []))

  /// Goal wall id -> cost-to-goal plus predecessors for every node.
  ///
  /// **R6 lives here.** In JS this is a `Map`, and `recost` picks which goal to
  /// refresh with `[...fields.keys()][turn % size]` -- so insertion order is
  /// load-bearing. Swift's `Dictionary` does not preserve it, and the wrong goal
  /// refreshing on the wrong tick re-prices a different set of edges, which
  /// surfaces 600 ticks later looking exactly like a behaviour bug. Hence an
  /// ordered array with a side index rather than a dictionary alone.
  private var fieldOrder: [Int] = []
  private var fieldByWall: [Int: DijkstraResult] = [:]

  private var radius: Double = 13
  /// The graph's clear-ground edge weights, kept when a recost writes crowd
  /// slowdowns into the working copy.
  private var baseWeights: [Float] = []
  /// Per-edge slowdown, EMA'd across recosts; 1 everywhere on a clear map.
  private var edgeSlow: [Float] = []
  /// Which goal the next recost refreshes; they take turns.
  private var recostTurn = 0

  /// How many nearest candidates `nextWaypoint` tests before giving up and
  /// scanning everything. Eight, because the nodes closest to a pedestrian are
  /// the corners of the buildings around it and one of those is almost always
  /// in sight; the fallback is there for when it is not, not as the usual path.
  private static let CANDIDATES = 8
  /// Reused across calls rather than allocated per pedestrian per tick, the
  /// same reason `SpatialHash` hands back a shared buffer.
  private var candidateTotal = [Double](repeating: .infinity, count: CANDIDATES)
  private var candidateNode = [Int32](repeating: -1, count: CANDIDATES)

  public init() {}

  /// Everything a rebuild produces, and nothing that cannot cross a thread.
  ///
  /// `BlockerIndex` is deliberately absent: it is a class with a mutable query
  /// buffer, and its counting sort over a few hundred groups costs microseconds,
  /// so `install` rebuilds it rather than the type being made `Sendable` on the
  /// strength of a promise.
  public struct Build: Sendable {
    public var graph: VisibilityGraph
    public var fieldOrder: [Int]
    public var fieldByWall: [Int: DijkstraResult]
    public var radius: Double
  }

  /// The whole cost of a rebuild, as a pure function.
  ///
  /// Free of `self` on purpose: it is what runs off the main actor while the
  /// crowd keeps walking on the graph it already has. Measured at 2.1s on a
  /// forced 600m import, which is the freeze this exists to move.
  public static func build(_ walls: [WallSnapshot], _ radius: Double) -> Build {
    let objects = walls.map(\.wall)
    let graph = buildVisibilityGraph(objects, radius)
    var order: [Int] = []
    var fields: [Int: DijkstraResult] = [:]
    for wall in objects {
      if !wall.isGoal { continue }
      order.append(wall.id)
      fields[wall.id] = dijkstra(graph.csr, nodesOfWall(graph, wall.id))
    }
    return Build(graph: graph, fieldOrder: order, fieldByWall: fields, radius: radius)
  }

  /// Swaps a built graph in. Cheap, and the only part that must be on the actor
  /// that owns this object.
  public func install(_ build: Build) {
    radius = build.radius
    graph = build.graph
    // Built here rather than inside `Blockers`, which stays three fields wide
    // for the sweep's sake -- see the note on that type.
    blockerGroups = graph.blockers.groups
    shellByWall = Dictionary(graph.blockers.shells.map { ($0.wallId, $0) },
                             uniquingKeysWith: { a, _ in a })
    blockerIndex = BlockerIndex()
    blockerIndex.build(blockerGroups)
    baseWeights = graph.csr.weights
    edgeSlow = [Float](repeating: 1, count: graph.csr.targets.count)
    recostTurn = 0
    fieldOrder = build.fieldOrder
    fieldByWall = build.fieldByWall
  }

  /// Build and install in one breath, on whatever thread asks. What every
  /// caller did before there was a background path, and still what the
  /// conformance runner and the tests use.
  public func rebuild(_ walls: [Wall], _ radius: Double) {
    install(Self.build(walls.map(WallSnapshot.init), radius))
  }

  /// Reads the crowd and re-prices the routes, so a jam is a thing the field
  /// knows about rather than a surprise every pedestrian meets in person.
  ///
  /// Each edge is sampled every hundred pixels, each sample counts heads in the
  /// same window the walkers judge their own pace in, and the per-sample
  /// slowdown is averaged along the edge -- the mean of 1/pace, which is what an
  /// integral of traversal time actually is, so a long clear edge with one busy
  /// patch is priced as mostly clear.
  public func recost(_ hash: SpatialHash, _ x: [Float], _ y: [Float], _ crowdCount: Int) {
    if fieldOrder.isEmpty { return }
    let window = PACE_WINDOW * radius

    if crowdCount == 0 {
      for i in 0..<edgeSlow.count { edgeSlow[i] = 1 }
      graph.csr.weights = baseWeights
    } else {
      for u in 0..<graph.csr.nodeCount {
        let from = graph.nodes[u]
        var e = Int(graph.csr.offsets[u])
        let end = Int(graph.csr.offsets[u + 1])
        while e < end {
          defer { e += 1 }
          let to = graph.nodes[Int(graph.csr.targets[e])]
          let len = Double(baseWeights[e])
          let samples = jsMin(SAMPLES_MAX, jsMax(1, (len / SAMPLE_SPACING).rounded(.up)))
          var slow: Double = 0
          var s: Double = 0
          while s < samples {
            let t = (s + 0.5) / samples
            let px = from.x + (to.x - from.x) * t
            let py = from.y + (to.y - from.y) * t
            slow += crowdSlowdown(Double(hash.query(px, py, window, -1, x, y)))
            s += 1
          }
          let eased = Double(edgeSlow[e]) + (slow / samples - Double(edgeSlow[e])) * SLOW_EMA
          edgeSlow[e] = Float(eased)
          graph.csr.weights[e] = Float(Double(baseWeights[e]) * eased)
        }
      }
    }

    let goal = fieldOrder[recostTurn % fieldOrder.count]
    recostTurn += 1
    fieldByWall[goal] = dijkstra(graph.csr, nodesOfWall(graph, goal))
  }

  public var obstacles: [Obstacle] { graph.blockers.obstacles }
  /// Whole-wall convex hulls, expanded: the broad phase in front of the parts.
  public var shells: [WallShell] { graph.blockers.shells }
  public var blockers: Blockers { graph.blockers }
  /// Stored, not read through `blockers`: the per-agent point queries run ten
  /// times a substep, and reaching them through the struct copied a dictionary
  /// and an object reference every time.
  public private(set) var blockerIndex = BlockerIndex()
  public private(set) var blockerGroups: [WallPartGroup] = []
  public private(set) var shellByWall: [Int: WallShell] = [:]
  public var nodes: [Point] { graph.nodes }
  public var pedestrianRadius: Double { radius }

  public func hasGoal(_ wallId: Int) -> Bool { fieldByWall[wallId] != nil }

  /// Where an agent at `from` should head next on its way to `goalWallId`.
  ///
  /// A direct line to the goal always wins -- the original checked this too, in
  /// `setDirectPathIfPossible()`. Otherwise pick the visible graph node with the
  /// lowest "distance to it plus its cost-to-goal".
  public func nextWaypoint(_ from: Point, _ goalWallId: Int) -> Waypoint? {
    // Filtered by skipping rather than by `filter`, which allocated an array
    // here on every call -- and this runs once per *walking agent per tick*,
    // because every successful step sets `replan` and clears the waypoint. Same
    // obstacles in the same order, so the answer is unchanged; `hasArrived`
    // below has always done it this way.
    var anyPart = false

    // A concave goal is several convex parts; take the nearest visible point on
    // any of them.
    var direct: Point?
    var directDist = Double.infinity
    for part in graph.blockers.obstacles {
      if part.wallId != goalWallId { continue }
      anyPart = true
      guard let p = closestVisiblePointOnHull(from, part) else { continue }
      let d = distance(from, p)
      if d < directDist { directDist = d; direct = p }
    }
    if !anyPart { return nil }
    if let direct { return Waypoint(point: direct, cost: directDist, node: -1) }

    guard let result = fieldByWall[goalWallId] else { return nil }

    // A bound first, then the scan.
    //
    // A sampling profile put the `isVisible` call below at 504 of 513 samples:
    // nearly the whole tick on a 600m import was visibility tests from here.
    // The scan tests every node that beats the running best, and since the best
    // starts at infinity, whichever node index order happens to hand over first
    // sets a poor bound and lets dozens more through.
    //
    // So: find the *nearest* node by squared distance -- no `jsHypot`, no
    // visibility -- and if it can be seen, its total is an upper bound on the
    // answer. The scan then prunes against that from its very first node.
    //
    // Ranking every node by `step + cost` up front was tried instead and is
    // slightly *slower* (265ms against 240ms): it needs a real `jsHypot` per
    // node, where the cost prune below skips most of them before any distance
    // is computed at all.
    var nearest = -1
    var nearestD2 = Double.infinity
    let floorD2 = ON_NODE_EPSILON * ON_NODE_EPSILON
    for i in 0..<graph.nodes.count {
      if !result.dist[i].isFinite { continue }
      let node = graph.nodes[i]
      let dx = node.x - from.x, dy = node.y - from.y
      let d2 = dx * dx + dy * dy
      // Skip the node the agent is standing on. By the triangle inequality it
      // always minimises step + cost, so without this an agent that reaches a
      // corner re-selects it forever and parks there.
      if d2 < floorD2 { continue }
      if d2 < nearestD2 { nearestD2 = d2; nearest = i }
    }
    var bound = Double.infinity
    if nearest >= 0, isVisible(from, graph.nodes[nearest], graph.blockers) {
      bound = distance(from, graph.nodes[nearest]) + Double(result.dist[nearest])
    }

    var best = -1
    var bestCost = Double.infinity
    for i in 0..<graph.nodes.count {
      let cost = Double(result.dist[i])
      if !cost.isFinite { continue }
      // `step` is strictly positive below, so `total > cost`: a node whose
      // cost-to-goal alone already exceeds a bound cannot beat it. Strict, so a
      // node tying the bound is still considered -- the scan keeps the
      // *earliest* index among equal minima, and the bound's own node may not
      // be the earliest.
      if cost > bound { continue }
      if cost >= bestCost { continue }
      let node = graph.nodes[i]
      let step = distance(from, node)
      if step < ON_NODE_EPSILON { continue }
      let total = step + cost
      if total > bound { continue }
      if total >= bestCost { continue }
      if !isVisible(from, node, graph.blockers) { continue }
      bestCost = total
      best = i
    }
    return best >= 0
      ? Waypoint(point: graph.nodes[best], cost: bestCost, node: best)
      : nil
  }

  public func nodePosition(_ node: Int) -> Point? {
    node >= 0 && node < graph.nodes.count ? graph.nodes[node] : nil
  }

  /// The next node towards the goal after `node`, or -1 at the goal itself.
  /// `prev` was filled by a run seeded from the goal, so it points inward.
  public func successorOf(_ node: Int, _ goalWallId: Int) -> Int {
    guard let result = fieldByWall[goalWallId], node >= 0 else { return -1 }
    return Int(result.prev[node])
  }

  /// Whether a straight walk between two points is unobstructed.
  public func canSee(_ a: Point, _ b: Point) -> Bool { isVisible(a, b, graph.blockers) }

  /// The remaining route from a graph node to its goal, for the debug overlay.
  public func pathFromNode(_ node: Int, _ goalWallId: Int) -> [Point] {
    guard let result = fieldByWall[goalWallId], node >= 0 else { return [] }
    var out: [Point] = []
    var at = node
    var guardCount = 0
    while at != -1 && guardCount <= result.prev.count {
      out.append(graph.nodes[at])
      at = Int(result.prev[at])
      guardCount += 1
    }
    return out
  }

  /// The whole route a pedestrian standing at `from` would walk, for the paused
  /// preview -- it costs one `nextWaypoint` scan.
  public func routeFrom(_ from: Point, _ goalWallId: Int) -> [Point] {
    guard let next = nextWaypoint(from, goalWallId) else { return [] }
    // node -1 means the goal itself is in sight, so the route is that one hop.
    let rest = next.node >= 0 ? pathFromNode(next.node, goalWallId) : []
    return rest.isEmpty ? [from, next.point] : [from] + rest
  }

  /// True when the agent is close enough to its goal hull to stop.
  public func hasArrived(_ from: Point, _ goalWallId: Int, _ tolerance: Double) -> Bool {
    for part in graph.blockers.obstacles {
      if part.wallId != goalWallId { continue }
      let hull = part.hull
      let n = hull.count
      for i in 0..<n {
        let p = closestPointOnSegment(hull[i], hull[(i + 1) % n], from)
        if distance(p, from) <= tolerance { return true }
      }
    }
    return false
  }

  private func closestVisiblePointOnHull(_ from: Point, _ goal: Obstacle) -> Point? {
    let hull = goal.hull
    var best: Point?
    var bestDist = Double.infinity
    let n = hull.count
    for i in 0..<n {
      let p = closestPointOnSegment(hull[i], hull[(i + 1) % n], from)
      let d = distance(p, from)
      if d >= bestDist { continue }
      if !isVisible(from, p, graph.blockers) { continue }
      bestDist = d
      best = p
    }
    return best
  }
}
