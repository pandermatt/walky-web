import Foundation

/// Ports `src/sim/visibilityGraph.ts`.
///
/// Nodes are the corners of every wall's convex parts expanded by the
/// pedestrian radius; edges join corners that can see each other.

/// Tolerance for "this point sits on the hull outline rather than inside it".
private let BOUNDARY_EPSILON = 1e-6

/// How much further out the graph nodes sit than the blocking boundary.
///
/// Without it a node lands exactly *on* the hull it belongs to, where
/// point-in-polygon is a coin flip and half the surrounding lattice cells are
/// illegal -- pedestrians could never legally stand on their own waypoint and
/// would stall against the corner, jittering.
public let NODE_MARGIN: Double = 2

/// How much wider than the pedestrian radius a wall's shell is expanded.
///
/// The shell is only a reject, so it is only sound while it contains every
/// part. A needle part inside the hull can have a far sharper corner than the
/// hull does, so its own cut corner may reach further out than the hull's.
///
/// Baked as a literal rather than computed: in JS this is a module-init
/// `Math.hypot(MITER_LIMIT, 1)`, and while `jsHypot` would give the same bits,
/// a constant that must match across two languages is better written down once
/// than derived twice.
private let SHELL_SLACK: Double = 2.23606797749978969   // hypot(2, 1) = sqrt(5)

public struct BBox {
  public var minX: Double, minY: Double, maxX: Double, maxY: Double
}

public struct Obstacle {
  public var wallId: Int
  /// Index of this convex part among all obstacles, used for ring adjacency.
  public var partId: Int
  /// One convex part of the wall, pushed out by the pedestrian radius.
  public var hull: [Point]
  public var bbox: BBox
}

/// A whole wall's convex hull, expanded: the broad phase for that wall.
public struct WallShell {
  public var wallId: Int
  public var hull: [Point]
  public var bbox: BBox
}

/// A wall's shell together with its parts, so the broad phase needs no lookup.
public struct WallPartGroup {
  public var shell: WallShell?
  public var parts: [Obstacle]
}

public struct Blockers {
  public var obstacles: [Obstacle]
  public var shells: [WallShell]
  public var groups: [WallPartGroup]
}

public struct VisibilityGraph {
  public var nodes: [Point]
  /// Which wall each node's part belongs to; goals are seeded by this.
  public var nodeWall: [Int32]
  /// Which convex part each node came from.
  public var nodePart: [Int32]
  /// Position of each node within its own hull ring, for the adjacency rule.
  public var nodeRingIndex: [Int32]
  public var ringLength: [Int32]
  public var csr: CsrGraph
  public var blockers: Blockers

  public var obstacles: [Obstacle] { blockers.obstacles }
  public var shells: [WallShell] { blockers.shells }
}

private func bboxOf(_ poly: [Point]) -> BBox {
  var minX = Double.infinity, minY = Double.infinity
  var maxX = -Double.infinity, maxY = -Double.infinity
  for p in poly {
    if p.x < minX { minX = p.x }
    if p.x > maxX { maxX = p.x }
    if p.y < minY { minY = p.y }
    if p.y > maxY { maxY = p.y }
  }
  return BBox(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
}

@inline(__always)
private func segmentMissesBox(_ a: Point, _ b: Point, _ box: BBox) -> Bool {
  (jsMax(a.x, b.x) < box.minX) || (jsMin(a.x, b.x) > box.maxX)
    || (jsMax(a.y, b.y) < box.minY) || (jsMin(a.y, b.y) > box.maxY)
}

/// Whether a straight walk from `a` to `b` is possible.
///
/// The hulls are already expanded by the pedestrian radius, so clearance is
/// built into the geometry. Two rules: the segment must not properly cross any
/// hull edge, and its midpoint must not fall strictly inside a hull -- which is
/// what rejects a chord between two non-adjacent corners of the *same* hull,
/// crossing no edge yet passing straight through the building.
///
/// The midpoint is exempt when it lies *on* the outline: walking from one hull
/// corner to the next puts the midpoint exactly on that edge, and ray casting
/// on the boundary is a coin flip.
public func isVisible(_ a: Point, _ b: Point, _ blockers: Blockers) -> Bool {
  let mid = Point((a.x + b.x) / 2, (a.y + b.y) / 2)

  for group in blockers.groups {
    if let shell = group.shell {
      if segmentMissesBox(a, b, shell.bbox) { continue }
      if !touchesHull(a, b, mid, shell.hull) { continue }
    }
    for ob in group.parts {
      if segmentMissesBox(a, b, ob.bbox) { continue }
      let hull = ob.hull
      var onOutline = false
      let n = hull.count
      for i in 0..<n {
        let p = hull[i]
        let q = hull[(i + 1) % n]
        if segmentsCross(a, b, p, q) { return false }
        if !onOutline && pointSegmentDistance(p, q, mid) <= BOUNDARY_EPSILON { onOutline = true }
      }
      if !onOutline && pointInPolygon(hull, mid) { return false }
    }
  }
  return true
}

/// Whether a segment enters or crosses a convex outline at all.
private func touchesHull(_ a: Point, _ b: Point, _ mid: Point, _ hull: [Point]) -> Bool {
  let n = hull.count
  for i in 0..<n {
    if segmentsCross(a, b, hull[i], hull[(i + 1) % n]) { return true }
  }
  return pointInPolygon(hull, a) || pointInPolygon(hull, b) || pointInPolygon(hull, mid)
}

/// Builds the graph Dijkstra runs over.
///
/// The naive O(n^2) pair sweep with a bounding-box reject per obstacle, which is
/// ample for the hundreds of corners a hand-drawn map produces.
public func buildVisibilityGraph(_ walls: [Wall], _ radius: Double) -> VisibilityGraph {
  var obstacles: [Obstacle] = []
  var nodes: [Point] = []
  var nodeWall: [Int32] = []
  var nodePart: [Int32] = []
  var nodeRingIndex: [Int32] = []
  var ringLength: [Int32] = []

  var shells: [WallShell] = []
  // Node positions live on a slightly larger ring than the blocking hull, so
  // that every node is somewhere a pedestrian can legally stand.
  var nodeRings: [[Point]] = []

  for wall in walls {
    // A wall of fewer than three distinct points has no hull to reject against;
    // that costs the broad phase, never an obstacle.
    if wall.hull.count >= 3 {
      let shellHull = expandPolygon(wall.hull, radius * SHELL_SLACK)
      shells.append(WallShell(wallId: wall.id, hull: shellHull, bbox: bboxOf(shellHull)))
    }
    for poly in wall.polygons {
      for part in convexDecompose(poly) {
        if part.count < 3 { continue }
        let hull = expandPolygon(part, radius)
        obstacles.append(Obstacle(wallId: wall.id, partId: obstacles.count,
                                  hull: hull, bbox: bboxOf(hull)))
        nodeRings.append(expandPolygon(part, radius + NODE_MARGIN))
      }
    }
  }

  let groups: [WallPartGroup] = walls.map { w in
    WallPartGroup(shell: shells.first { $0.wallId == w.id },
                  parts: obstacles.filter { $0.wallId == w.id })
  }
  let blockers = Blockers(obstacles: obstacles, shells: shells, groups: groups)

  // A corner swallowed by another building's hull is not standable, so drop it.
  for o in 0..<obstacles.count {
    let ob = obstacles[o]
    let ring = nodeRings[o]
    for i in 0..<ring.count {
      let p = ring[i]
      var blocked = false
      var k = 0
      while k < obstacles.count && !blocked {
        if k == o { k += 1; continue }
        if pointInPolygon(obstacles[k].hull, p) { blocked = true }
        k += 1
      }
      if blocked { continue }
      nodes.append(p)
      nodeWall.append(Int32(ob.wallId))
      nodePart.append(Int32(ob.partId))
      nodeRingIndex.append(Int32(i))
      ringLength.append(Int32(ring.count))
    }
  }

  // Pairwise visibility. Every pair gets a real test, including two corners of
  // the same convex part: a wall made of several parts can have one lying
  // across another's edge, and the old ring-neighbour shortcut ran an edge
  // straight through it.
  let n = nodes.count
  var neighbours = [[Int32]](repeating: [], count: n)
  var costs = [[Double]](repeating: [], count: n)

  for i in 0..<n {
    for j in (i + 1)..<n {
      if !isVisible(nodes[i], nodes[j], blockers) { continue }
      let w = distance(nodes[i], nodes[j])
      neighbours[i].append(Int32(j)); costs[i].append(w)
      neighbours[j].append(Int32(i)); costs[j].append(w)
    }
  }

  var offsets = [Int32](repeating: 0, count: n + 1)
  for i in 0..<n { offsets[i + 1] = offsets[i] + Int32(neighbours[i].count) }
  let edgeCount = Int(offsets[n])
  var targets = [Int32](repeating: 0, count: edgeCount)
  var weights = [Float](repeating: 0, count: edgeCount)
  var k = 0
  for i in 0..<n {
    for e in 0..<neighbours[i].count {
      targets[k] = neighbours[i][e]
      weights[k] = Float(costs[i][e])
      k += 1
    }
  }

  return VisibilityGraph(
    nodes: nodes, nodeWall: nodeWall, nodePart: nodePart,
    nodeRingIndex: nodeRingIndex, ringLength: ringLength,
    csr: CsrGraph(nodeCount: n, offsets: offsets, targets: targets, weights: weights),
    blockers: blockers)
}

/// Node indices belonging to a wall -- the seed set for a goal's Dijkstra run.
public func nodesOfWall(_ graph: VisibilityGraph, _ wallId: Int) -> [Int] {
  var out: [Int] = []
  for i in 0..<graph.nodeWall.count where graph.nodeWall[i] == Int32(wallId) { out.append(i) }
  return out
}
