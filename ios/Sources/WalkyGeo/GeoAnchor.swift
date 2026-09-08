import Foundation
import WalkySim

/// A WGS84 position. Deliberately not `CLLocationCoordinate2D`: this target
/// carries no framework, so it runs under plain `swift test` -- the same reason
/// `WalkySim` and `WalkyCore` are packages rather than app-target sources.
public struct Coordinate: Equatable, Sendable {
  public var latitude: Double
  public var longitude: Double
  public init(latitude: Double, longitude: Double) {
    self.latitude = latitude
    self.longitude = longitude
  }
}

/// A north-west/south-east box in degrees.
public struct BoundingBox: Equatable, Sendable {
  public var south: Double, west: Double, north: Double, east: Double

  public init(south: Double, west: Double, north: Double, east: Double) {
    self.south = south; self.west = west; self.north = north; self.east = east
  }

  public var centre: Coordinate {
    Coordinate(latitude: (south + north) / 2, longitude: (west + east) / 2)
  }

  public func contains(_ c: Coordinate) -> Bool {
    c.latitude >= south && c.latitude <= north && c.longitude >= west && c.longitude <= east
  }
}

/// Where the world's origin sits on the earth.
///
/// The simulation needs no projection of its own -- it is already metric, at
/// `PX_PER_METRE` to the metre, anchored on Weidmann's shoulder radius. So all
/// this has to do is turn degrees into metres correctly, once, about a point.
///
/// It is a local tangent plane, not Web Mercator. Mercator's scale error is
/// `1/cos(latitude)` -- a factor of 1.48 at Winterthur -- which would put every
/// building at half again its true size while the pedestrians walking around
/// them stayed 1.34 m/s. The two radii of curvature below differ by 0.3%
/// between them, which over a 300 m import is a metre: small, and exactly the
/// kind of metre that shows as footprints sitting off their own rooftops.
///
/// Valid for the few hundred metres an import covers. It is not a geodesy
/// library and should not be used as one.
public struct GeoAnchor: Equatable, Sendable {
  /// The coordinate that world `(0, 0)` stands for.
  public let origin: Coordinate

  /// Real metres to one world metre: a model railway's ratio, where 10 means
  /// 1:10 and 1 means life size.
  ///
  /// **It lives here and not in the importer**, because `world` and
  /// `coordinate` are inverses and half the app depends on their staying that
  /// way: the Overpass query box, the basemap crop and the walking routes
  /// MapKit is asked for are all derived by going back out through
  /// `coordinate`. Scale one direction only and every one of them is silently
  /// wrong by the ratio.
  ///
  /// The pedestrian does **not** scale -- 13 world units is a 0.46m body
  /// whatever the map is doing -- which is the whole point: at 1:10 people are
  /// ten times larger against the buildings, which is what makes a real place
  /// legible on a phone. The cost is that obstacle inflation does not scale
  /// either, so only streets wider than about `0.93 * scale` metres still admit
  /// anybody. See `ios/README.md`.
  public let scale: Double

  /// Metres per degree of latitude and of longitude, at the origin.
  private let metresPerDegreeLatitude: Double
  private let metresPerDegreeLongitude: Double

  public init(origin: Coordinate, scale: Double = 1) {
    self.origin = origin
    self.scale = scale > 0 ? scale : 1

    // WGS84.
    let a = 6_378_137.0
    let f = 1 / 298.257223563
    let eSquared = f * (2 - f)

    let phi = origin.latitude * .pi / 180
    let sinPhi = sin(phi)
    let w = 1 - eSquared * sinPhi * sinPhi

    // Meridional radius of curvature: north-south.
    let meridional = a * (1 - eSquared) / (w * sqrt(w))
    // Prime vertical radius of curvature: east-west, before the cos(phi).
    let primeVertical = a / sqrt(w)

    self.metresPerDegreeLatitude = meridional * .pi / 180
    self.metresPerDegreeLongitude = primeVertical * cos(phi) * .pi / 180
  }

  /// World +x is east and world +y is **south** -- the screen's own axes, which
  /// `Viewport.worldToScreen` leaves alone, and which `MKMapPoint` shares.
  public func world(_ c: Coordinate) -> Point {
    let east = (c.longitude - origin.longitude) * metresPerDegreeLongitude
    let south = (origin.latitude - c.latitude) * metresPerDegreeLatitude
    return Point(east * worldPerMetre, south * worldPerMetre)
  }

  public func coordinate(_ p: Point) -> Coordinate {
    let east = p.x / worldPerMetre
    let south = p.y / worldPerMetre
    return Coordinate(latitude: origin.latitude - south / metresPerDegreeLatitude,
                      longitude: origin.longitude + east / metresPerDegreeLongitude)
  }

  /// World units one real metre buys. The single place the ratio is applied, so
  /// the two conversions above cannot drift apart.
  public var worldPerMetre: Double { PX_PER_METRE / scale }

  /// Real metres a world distance stands for -- what every readout owes its
  /// user. `polylineMetres` and the import's "m across" both go through this,
  /// so a 1:10 map still reports the distance somebody would really walk.
  public func metres(_ worldDistance: Double) -> Double { worldDistance / worldPerMetre }

  /// The box a world rectangle stands for -- what a basemap snapshot is asked for.
  public func boundingBox(worldMinX: Double, worldMinY: Double,
                          worldMaxX: Double, worldMaxY: Double) -> BoundingBox {
    let northWest = coordinate(Point(worldMinX, worldMinY))
    let southEast = coordinate(Point(worldMaxX, worldMaxY))
    return BoundingBox(south: southEast.latitude, west: northWest.longitude,
                       north: northWest.latitude, east: southEast.longitude)
  }

  /// A box of the given side length in metres, centred on the origin.
  ///
  /// Scale-free by construction: the world half-width is scaled going in and
  /// unscaled coming back out through `coordinate`, so the same request fetches
  /// the same piece of the earth at every ratio.
  public func boundingBox(sideMetres: Double) -> BoundingBox {
    let half = sideMetres / 2 * worldPerMetre
    return boundingBox(worldMinX: -half, worldMinY: -half, worldMaxX: half, worldMaxY: half)
  }

  /// The world rectangle a centred box of real metres occupies -- what the
  /// basemap snapshot is cropped to.
  public func worldHalfWidth(sideMetres: Double) -> Double {
    sideMetres / 2 * worldPerMetre
  }
}
