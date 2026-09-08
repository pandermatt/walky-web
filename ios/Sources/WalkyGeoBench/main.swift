// M0: does the navigation rebuild survive real OpenStreetMap footprints?
//
// Throwaway. It answers one question -- what a real neighbourhood costs the
// visibility sweep, and what simplification tolerance buys back -- before any
// of the feature is built. Delete once the number is known.

import Foundation
import WalkySim
import WalkyCore
import WalkyGeo

// MARK: - The .osm extracts the Java original shipped

/// Equirectangular about an anchor latitude, in world pixels.
///
/// The model is anchored at 56px to the metre, so a projection only has to get
/// metres right. Over a 500m patch the anchor's cos(lat) is the whole story;
/// MKMapPoint's own per-latitude constant replaces this in WalkyGeo.
struct LocalProjection {
  static let earthRadius = 6_378_137.0
  let lat0: Double, lon0: Double
  let cosLat0: Double

  init(lat0: Double, lon0: Double) {
    self.lat0 = lat0
    self.lon0 = lon0
    self.cosLat0 = cos(lat0 * .pi / 180)
  }

  /// +x east, +y south -- the world's own axes, and MKMapPoint's.
  func worldPoint(lat: Double, lon: Double) -> Point {
    let east = (lon - lon0) * .pi / 180 * Self.earthRadius * cosLat0
    let south = (lat0 - lat) * .pi / 180 * Self.earthRadius
    return Point(east * PX_PER_METRE, south * PX_PER_METRE)
  }
}

final class OSMBuildings: NSObject, XMLParserDelegate {
  private var nodes: [String: (lat: Double, lon: Double)] = [:]
  private var wayRefs: [String] = []
  private var wayIsBuilding = false
  private var inWay = false
  var rings: [[(lat: Double, lon: Double)]] = []

  func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
              qualifiedName: String?, attributes attr: [String: String]) {
    switch name {
    case "node":
      if let id = attr["id"], let lat = attr["lat"].flatMap(Double.init),
         let lon = attr["lon"].flatMap(Double.init) {
        nodes[id] = (lat, lon)
      }
    case "way":
      inWay = true; wayRefs = []; wayIsBuilding = false
    case "nd":
      if inWay, let ref = attr["ref"] { wayRefs.append(ref) }
    case "tag":
      if inWay, attr["k"] == "building" { wayIsBuilding = true }
    default: break
    }
  }

  func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?,
              qualifiedName: String?) {
    guard name == "way" else { return }
    inWay = false
    guard wayIsBuilding else { return }
    let ring = wayRefs.compactMap { nodes[$0] }
    if ring.count >= 4 { rings.append(ring) }
  }
}

// MARK: - Conversion

func wallsFrom(_ path: String, tolerance: Double) -> (walls: [Wall], vertices: Int)? {
  guard let stream = InputStream(fileAtPath: path) else { return nil }
  let parser = XMLParser(stream: stream)
  let sink = OSMBuildings()
  parser.delegate = sink
  guard parser.parse() else { return nil }
  guard !sink.rings.isEmpty else { return nil }

  // Anchor on the centre of the extract, as an import will anchor on the
  // centre of the region asked for.
  var minLat = 90.0, maxLat = -90.0, minLon = 180.0, maxLon = -180.0
  for ring in sink.rings {
    for p in ring {
      minLat = min(minLat, p.lat); maxLat = max(maxLat, p.lat)
      minLon = min(minLon, p.lon); maxLon = max(maxLon, p.lon)
    }
  }
  let projection = LocalProjection(lat0: (minLat + maxLat) / 2, lon0: (minLon + maxLon) / 2)

  var walls: [Wall] = []
  var vertices = 0
  for (i, ring) in sink.rings.enumerated() {
    var points = ring.map { projection.worldPoint(lat: $0.lat, lon: $0.lon) }
    // An OSM way closes by repeating its first node; a polygon does not.
    if let first = points.first, let last = points.last, first == last { points.removeLast() }
    if tolerance > 0 { points = simplifyPolyline(points, tolerance) }
    guard points.count >= 3 else { continue }
    vertices += points.count
    walls.append(Wall(id: i, polygons: [points]))
  }
  return (walls, vertices)
}

// MARK: - Timing

let radius = 13.0          // the shipped default pedestrian radius
let repeats = 3

let maps = CommandLine.arguments.dropFirst()
guard !maps.isEmpty else {
  FileHandle.standardError.write(Data("usage: walky-geobench <map.osm>...\n".utf8))
  exit(2)
}

func milliseconds(_ body: () -> Void) -> Double {
  let start = DispatchTime.now().uptimeNanoseconds
  body()
  return Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
}

func median(_ xs: [Double]) -> Double {
  let s = xs.sorted()
  return s.isEmpty ? 0 : s[s.count / 2]
}

/// Bigger imports, from the extract we have.
///
/// Tiling the same neighbourhood keeps the vertex statistics of real buildings
/// -- which is the thing being measured -- where inventing polygons would not.
/// A k-by-k tiling stands for an import k times as wide.
func tiled(_ walls: [Wall], _ k: Int) -> [Wall] {
  if k <= 1 { return walls }
  var minX = Double.infinity, minY = Double.infinity
  var maxX = -Double.infinity, maxY = -Double.infinity
  for w in walls { for ring in w.polygons { for p in ring {
    minX = min(minX, p.x); maxX = max(maxX, p.x)
    minY = min(minY, p.y); maxY = max(maxY, p.y)
  } } }
  let width = maxX - minX, height = maxY - minY
  var out: [Wall] = []
  var id = 0
  for row in 0..<k {
    for col in 0..<k {
      let dx = Double(col) * width, dy = Double(row) * height
      for w in walls {
        out.append(Wall(id: id, polygons: w.polygons.map { $0.map { Point($0.x + dx, $0.y + dy) } }))
        id += 1
      }
    }
  }
  return out
}

func metres(_ walls: [Wall]) -> (w: Double, h: Double) {
  var minX = Double.infinity, minY = Double.infinity
  var maxX = -Double.infinity, maxY = -Double.infinity
  for w in walls { for ring in w.polygons { for p in ring {
    minX = min(minX, p.x); maxX = max(maxX, p.x)
    minY = min(minY, p.y); maxY = max(maxY, p.y)
  } } }
  return ((maxX - minX) / PX_PER_METRE, (maxY - minY) / PX_PER_METRE)
}

/// What one tick costs on real geometry, which no bench has ever asked.
///
/// `StepCostBench` has a maze, but it is twelve rectangles and about fifty
/// graph nodes; a 400m import is hundreds of wall groups and thousands of
/// nodes, and three of the per-agent costs scale with those rather than with
/// the crowd: `nextWaypoint`'s all-nodes scan, `hasArrived`'s pass over every
/// obstacle (twice per agent per tick), and `insideAnyWall`'s pass behind an
/// `inShell` broad phase that is itself a scan. This puts a number on the
/// difference between fifty nodes and three thousand.
func stepCost(_ source: [Wall], _ count: Int) -> (ms: Double, nodes: Int) {
  // Raw `WalkySim`, not `WalkyWorld` -- the world is `@MainActor` and this is a
  // script. Same shape as `Conformance.Runner`, which is the other caller that
  // steps the model without an app around it.
  var walls = source.map { Wall(id: $0.id, polygons: $0.polygons) }
  guard let last = walls.last else { return (0, 0) }
  last.isGoal = true

  var minX = Double.infinity, minY = Double.infinity
  var maxX = -Double.infinity, maxY = -Double.infinity
  for w in walls { for ring in w.polygons { for p in ring {
    minX = Swift.min(minX, p.x); maxX = Swift.max(maxX, p.x)
    minY = Swift.min(minY, p.y); maxY = Swift.max(maxY, p.y)
  } } }

  let nav = Navigation()
  nav.rebuild(walls, radius)
  let agents = Agents()
  let hash = SpatialHash()

  // Spread across the map, so the routes are long and genuinely have to find
  // their way round the buildings rather than see the goal from the start.
  let cols = Int(Double(count).squareRoot().rounded(.up))
  let pitch = 2.2 * radius
  for k in 0..<count {
    let at = Point(minX + Double(k % cols) * pitch, minY + Double(k / cols) * pitch)
    let i = agents.add(at, last.color)
    agents.setGoal(i, last.id, last.color)
  }

  let speed = pxPerTickFromMps(1.35)
  for _ in 0..<5 { agents.step(nav, hash, speed, radius, 40) }
  let ms = median((0..<repeats).map { _ in
    milliseconds { for _ in 0..<20 { agents.step(nav, hash, speed, radius, 40) } } / 20
  })
  return (ms, nav.nodes.count)
}

/// What a ring-size distribution looks like, which is what `SIMPLIFY_ABOVE`
/// is set from. Buildings are not uniform: most are near the median and a
/// small tail of traced curves carries a disproportionate share of corners.
func histogram(_ walls: [Wall]) {
  let sizes = walls.flatMap { $0.polygons.map(\.count) }.sorted()
  guard !sizes.isEmpty else { return }
  let total = sizes.reduce(0, +)
  func pct(_ p: Int) -> Int { sizes[min(sizes.count - 1, sizes.count * p / 100)] }
  let tail = sizes.filter { $0 > SIMPLIFY_ABOVE }
  print(String(format: "  rings %d, corners %d, mean %.1f, median %d, p90 %d, p99 %d, max %d",
               sizes.count, total, Double(total) / Double(sizes.count),
               pct(50), pct(90), pct(99), sizes.last!))
  print(String(format: "  over SIMPLIFY_ABOVE=%d: %d rings (%.1f%%) holding %d corners (%.1f%%)",
               SIMPLIFY_ABOVE, tail.count, 100 * Double(tail.count) / Double(sizes.count),
               tail.reduce(0, +), 100 * Double(tail.reduce(0, +)) / Double(total)))
}

/// The same walls with `mergeFootprints` applied, so the two can be timed
/// against each other rather than argued about.
func merged(_ walls: [Wall], _ radius: Double) -> [Wall] {
  let rings = mergeFootprints(walls.flatMap { $0.polygons },
                              simplifyTolerance: radius / 2)
  return rings.enumerated().map { Wall(id: $0.offset, polygons: [$0.element]) }
}

print("radius \(radius)px, \(repeats) runs each, median ms")
print("Simplification alone is not the lever: an ordinary building is already")
print("minimal. Merging is, and this asks by how much -- raw against merged.\n")
print("map            tiling   extent m    walls  verts  nodes    rebuild  groupWalls")
print(String(repeating: "-", count: 78))

for path in maps {
  let name = (path as NSString).lastPathComponent
  guard let (base, _) = wallsFrom(path, tolerance: 0) else {
    print("\(name): could not read"); continue
  }
  print("\(name):")
  histogram(base)
  print("")

  if ProcessInfo.processInfo.environment["STEP"] != nil {
    print("  tick cost on this map, ms per tick")
    print("  agents   raw walls          merged walls")
    for n in [250, 500, 1000] {
      let r = stepCost(base, n)
      let m = stepCost(merged(base, radius), n)
      print(String(format: "  %6d   %7.2f ms (%5d nodes)   %7.2f ms (%5d nodes)",
                   n, r.ms, r.nodes, m.ms, m.nodes))
      fflush(stdout)
    }
    print("")
  }
  for k in (ProcessInfo.processInfo.environment["TILES"].map { $0.split(separator: ",").compactMap { Int($0) } } ?? [1, 2, 3]) {
    for (label, walls) in [("raw", tiled(base, k)), ("merged", merged(tiled(base, k), radius))] {
      _ = label
    let vertices = walls.reduce(0) { $0 + $1.polygons.reduce(0) { $0 + $1.count } }
    let size = metres(walls)
    var nodeCount = 0
    let rebuild = median((0..<repeats).map { _ in
      let nav = Navigation()
      return milliseconds { nav.rebuild(walls, radius); nodeCount = nav.nodes.count }
    })
    let grouping = median((0..<repeats).map { _ in milliseconds { _ = groupWalls(walls) } })
    print(String(format: "%-14s %dx%d   %4.0fx%-4.0f %6d %6d %6d %9.1f %11.1f",
                 ("\(name) \(label)" as NSString).utf8String!, k, k, size.w, size.h,
                 walls.count, vertices, nodeCount, rebuild, grouping))
    fflush(stdout)
    }
  }
  print("")
}
