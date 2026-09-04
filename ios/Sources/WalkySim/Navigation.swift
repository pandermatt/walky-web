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

  public init() {}

  public func rebuild(_ walls: [Wall], _ radius: Double) {
    self.radius = radius
    graph = buildVisibilityGraph(walls, radius)
    baseWeights = graph.csr.weights
    edgeSlow = [Float](repeating: 1, count: graph.csr.targets.count)
    recostTurn = 0
    fieldOrder.removeAll()
    fieldByWall.removeAll()
    for wall in walls {
      if !wall.isGoal { continue }
      let sources = nodesOfWall(graph, wall.id)
      fieldOrder.append(wall.id)
      fieldByWall[wall.id] = dijkstra(graph.csr, sources)
    }
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
  public var nodes: [Point] { graph.nodes }
  public var pedestrianRadius: Double { radius }

  public func hasGoal(_ wallId: Int) -> Bool { fieldByWall[wallId] != nil }

  /// Where an agent at `from` should head next on its way to `goalWallId`.
  ///
  /// A direct line to the goal always wins -- the original checked this too, in
  /// `setDirectPathIfPossible()`. Otherwise pick the visible graph node with the
  /// lowest "distance to it plus its cost-to-goal".
  public func nextWaypoint(_ from: Point, _ goalWallId: Int) -> Waypoint? {
    let parts = graph.blockers.obstacles.filter { $0.wallId == goalWallId }
    if parts.isEmpty { return nil }

    // A concave goal is several convex parts; take the nearest visible point on
    // any of them.
    var direct: Point?
    var directDist = Double.infinity
    for part in parts {
      guard let p = closestVisiblePointOnHull(from, part) else { continue }
      let d = distance(from, p)
      if d < directDist { directDist = d; direct = p }
    }
    if let direct { return Waypoint(point: direct, cost: directDist, node: -1) }

    guard let result = fieldByWall[goalWallId] else { return nil }

    var best = -1
    var bestCost = Double.infinity
    for i in 0..<graph.nodes.count {
      let cost = Double(result.dist[i])
      if !cost.isFinite { continue }
      let node = graph.nodes[i]
      let step = distance(from, node)
      // Skip the node the agent is standing on. By the triangle inequality it
      // always minimises step + cost, so without this an agent that reaches a
      // corner re-selects it forever and parks there.
      if step < ON_NODE_EPSILON { continue }
      let total = step + cost
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
