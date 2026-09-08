import Foundation
import WalkySim

/// One building outline, as OpenStreetMap drew it.
public struct Footprint: Equatable, Sendable {
  public var ring: [Coordinate]
  public var name: String?
  public init(ring: [Coordinate], name: String? = nil) {
    self.ring = ring
    self.name = name
  }
}

/// Footprints as the polygons `Wall` takes.
///
/// Deliberately *not* simplified. `simplifyPolyline` is what a freehand stroke
/// needs -- hundreds of points from one gesture -- and a surveyed building is
/// already minimal: measured over the three extracts the 2016 app shipped,
/// Ramer-Douglas-Peucker at half a metre removed 2% of vertices and 3% of the
/// navigation rebuild. It is not the lever, and running it would only add a
/// tolerance that can round a real corner off. See `ios/README.md`.
///
/// What the ring needs is smaller and duller: OpenStreetMap closes a way by
/// repeating its first node, and a polygon that repeats a vertex puts a
/// zero-length edge into the visibility graph.
public func footprintPolygons(_ footprints: [Footprint], _ anchor: GeoAnchor) -> [[Point]] {
  var out: [[Point]] = []
  out.reserveCapacity(footprints.count)
  for footprint in footprints {
    var ring = footprint.ring.map { anchor.world($0) }
    if let first = ring.first, let last = ring.last, first == last { ring.removeLast() }
    // A ring of two points is a line, and a wall needs an inside.
    if ring.count >= 3 { out.append(ring) }
  }
  return out
}

/// How much a set of footprints will cost the navigation rebuild.
///
/// The rebuild is superquadratic in the number of wall corners -- measured at
/// about `n^2.5` -- so an import that is merely twice as wide is thirty times
/// the work. This is the number an import is allowed or refused on, rather than
/// a distance in metres: building density varies by a factor of two between a
/// Winterthur terrace and its outskirts, so a box that is comfortable in one
/// place is a five-second freeze in the other.
public enum ImportBudget {
  /// Corners the visibility sweep can take while a wall edit still feels like
  /// an edit rather than a hang -- about 150ms on the machine this was measured
  /// on. See `walky-geobench` and the table in `ios/README.md`.
  public static let maxVertices = 1000

  public static func vertices(_ polygons: [[Point]]) -> Int {
    polygons.reduce(0) { $0 + $1.count }
  }

  public static func fits(_ polygons: [[Point]]) -> Bool {
    vertices(polygons) <= maxVertices
  }
}
