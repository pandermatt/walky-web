import Foundation
import WalkySim

/// One measurement: two points, and the two ways of walking between them.
///
/// Lengths are metres. `apple` is nil on a map with no real place under it,
/// where there is nothing for Apple to route on -- Walky's own figure stands
/// alone, which is still a measuring tape, because a drawn map is metric too.
public struct DetourMeasurement: Sendable {
  public var a: Point
  public var b: Point
  /// Walky's own path: the shortest walk around the buildings.
  public var walky: [Point]
  public var walkyMetres: Double
  /// Apple's walking route, in world units, including the stubs from the taps
  /// to where the route really begins and ends.
  public var apple: [Point]?
  public var appleMetres: Double?

  public init(a: Point, b: Point, walky: [Point], walkyMetres: Double,
              apple: [Point]? = nil, appleMetres: Double? = nil, scale: Double = 1) {
    self.a = a
    self.b = b
    self.walky = walky
    self.walkyMetres = walkyMetres
    self.apple = apple
    self.appleMetres = appleMetres
    self.scale = scale
  }

  /// Real metres to one world metre, from the map's `GeoAnchor`. 1 on a drawn
  /// map, which has no place on the earth and therefore no ratio to it.
  ///
  /// Carried on the measurement rather than looked up when the label is drawn:
  /// a measurement taken on a 1:10 import and still on screen after a new
  /// import must keep reporting the distance it actually measured.
  public var scale: Double = 1

  /// How much further Walky's path is than a straight line -- the detour a
  /// pedestrian pays to the buildings alone.
  public var straightMetres: Double { distance(a, b) / PX_PER_METRE * scale }

  /// Apple's route against Walky's. Above 1 means the mapped network asks for
  /// more walking than the geometry does, which is where a shortcut wants to be.
  public var ratio: Double? {
    guard let appleMetres, walkyMetres > 0 else { return nil }
    return appleMetres / walkyMetres
  }
}

/// The length of a polyline, in metres.
///
/// Written out rather than found: there is no polyline-length helper anywhere in
/// the project. Summed in `Double` on purpose -- `DijkstraResult.dist` is `Float`
/// storage, and reading the length off it would inherit a rounding the R1 note
/// at `Dijkstra.swift` exists to keep out of the arithmetic.
/// `scale` is the map's ratio to the earth -- 10 on a 1:10 import, 1 on a drawn
/// map. Without it a scaled map reports a tenth of the walk somebody would
/// really take, and the ratio against Apple's real-metre route means nothing.
public func polylineMetres(_ path: [Point], _ scale: Double = 1) -> Double {
  guard path.count > 1 else { return 0 }
  var total = 0.0
  for i in 0..<(path.count - 1) { total += distance(path[i], path[i + 1]) }
  return total / PX_PER_METRE * scale
}

/// Walky's own shortest walk between two arbitrary points.
///
/// The simulation routes *to goal walls*: `Navigation.rebuild` seeds one
/// multi-source Dijkstra per goal and every public query is keyed on a wall id.
/// A measurement has no wall at either end, so this builds its own graph and
/// asks its own question -- using nothing but `WalkySim`'s public surface, so
/// not one line of the conformance-checked simulation changes.
///
/// It deliberately does **not** read `world.nav`. `Navigation.recost` overwrites
/// the live edge weights with crowd-priced traversal times every 120 ticks, so a
/// measurement taken from the running graph would quietly be a congestion
/// measurement rather than a distance. A graph built here is clear-ground by
/// construction, and a detour ratio has to be.
public final class MeasuringGraph {
  private var graph: VisibilityGraph?
  private var builtRevision = -1
  private var builtRadius = Double.nan

  public init() {}

  /// Rebuilt only when the walls or the pedestrian's size have actually changed.
  ///
  /// The sweep is the expensive part -- about 150ms at the import ceiling, the
  /// same budget a wall edit already pays -- and every measurement afterwards is
  /// about a millisecond.
  private func graph(_ walls: [Wall], _ radius: Double, _ revision: Int) -> VisibilityGraph {
    if let graph, builtRevision == revision, builtRadius == radius { return graph }
    let built = buildVisibilityGraph(walls, radius)
    graph = built
    builtRevision = revision
    builtRadius = radius
    return built
  }

  public func invalidate() {
    graph = nil
    builtRevision = -1
  }

  /// The path from `a` to `b`, or nil if the buildings make it impossible.
  ///
  /// Nodes sit on the `radius + NODE_MARGIN` ring around each obstacle, so what
  /// comes back is the clearance path a pedestrian of this size actually walks,
  /// not a line scraping the walls. Changing the pedestrian size changes the
  /// answer, which is correct and worth saying out loud in the readout.
  public func route(from a: Point, to b: Point,
                    walls: [Wall], radius: Double, revision: Int) -> [Point]? {
    let graph = graph(walls, radius, revision)
    let blockers = graph.blockers

    // The common case on open ground, and the cheapest.
    if isVisible(a, b, blockers) { return [a, b] }

    let nodes = graph.nodes
    let n = nodes.count
    guard n > 0 else { return nil }

    let seesA = nodes.map { isVisible(a, $0, blockers) }
    let seesB = nodes.map { isVisible(b, $0, blockers) }

    // The graph, plus `a` as node n and `b` as node n+1.
    //
    // Only the edges the search actually walks are built: out of `a`, and into
    // `b` from anywhere that can see it. Nothing routes back out of `b` and
    // nothing routes into `a`, because the search only ever leaves it.
    let old = graph.csr
    var offsets: [Int32] = []
    var targets: [Int32] = []
    var weights: [Float] = []
    offsets.reserveCapacity(n + 3)
    targets.reserveCapacity(old.targets.count + 2 * n + 1)
    weights.reserveCapacity(old.weights.count + 2 * n + 1)

    for v in 0..<n {
      offsets.append(Int32(targets.count))
      for e in Int(old.offsets[v])..<Int(old.offsets[v + 1]) {
        targets.append(old.targets[e])
        weights.append(old.weights[e])
      }
      if seesB[v] {
        targets.append(Int32(n + 1))
        weights.append(Float(distance(nodes[v], b)))
      }
    }

    offsets.append(Int32(targets.count))          // node n: a
    for v in 0..<n where seesA[v] {
      targets.append(Int32(v))
      weights.append(Float(distance(a, nodes[v])))
    }

    offsets.append(Int32(targets.count))          // node n+1: b, no way out
    offsets.append(Int32(targets.count))          // the terminator

    // One source, at a true distance of zero -- which is the only seeding
    // `dijkstra` offers, and exactly the one this needs.
    let augmented = CsrGraph(nodeCount: n + 2, offsets: offsets,
                             targets: targets, weights: weights)
    let result = dijkstra(augmented, [n])
    guard result.dist[n + 1].isFinite else { return nil }

    // `pathFrom` walks predecessors back from b, so it arrives reversed.
    return pathFrom(result, n + 1).reversed().map { id in
      id == n ? a : (id == n + 1 ? b : nodes[id])
    }
  }

  /// The whole measurement, Walky's half of it.
  public func measure(from a: Point, to b: Point, walls: [Wall], radius: Double,
                      revision: Int, scale: Double = 1) -> DetourMeasurement? {
    guard let path = route(from: a, to: b, walls: walls, radius: radius, revision: revision)
    else { return nil }
    return DetourMeasurement(a: a, b: b, walky: path,
                             walkyMetres: polylineMetres(path, scale), scale: scale)
  }
}
