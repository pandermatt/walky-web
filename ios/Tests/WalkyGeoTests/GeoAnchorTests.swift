import Testing
import Foundation
import WalkySim
@testable import WalkyGeo

/// Winterthur Büelrain -- the centre of `map.xml`, the extract the 2016 app
/// shipped. Every distance here is checked against an independent method
/// rather than against this projection's own arithmetic.
private let winterthur = Coordinate(latitude: 47.496345, longitude: 8.729700)

/// Vincenty's inverse formula: the geodesic distance on the WGS84 ellipsoid,
/// iterated to convergence.
///
/// The obvious reference -- a haversine on a mean-radius sphere -- is not one.
/// It is wrong by the ratio of the mean radius to the prime vertical, which at
/// this latitude is 0.29% east-west: the very quantity `GeoAnchor` exists to
/// get right, so checking against it would only assert that both are spheres.
/// Vincenty shares no term with the code under test.
private func geodesicMetres(_ p1: Coordinate, _ p2: Coordinate) -> Double {
  let a = 6_378_137.0, f = 1 / 298.257223563
  let b = a * (1 - f)
  let L = (p2.longitude - p1.longitude) * .pi / 180
  let U1 = atan((1 - f) * tan(p1.latitude * .pi / 180))
  let U2 = atan((1 - f) * tan(p2.latitude * .pi / 180))
  let sinU1 = sin(U1), cosU1 = cos(U1), sinU2 = sin(U2), cosU2 = cos(U2)

  var lambda = L, sinSigma = 0.0, cosSigma = 0.0, sigma = 0.0
  var cos2SigmaM = 0.0, cosSqAlpha = 0.0
  for _ in 0..<200 {
    let sinLambda = sin(lambda), cosLambda = cos(lambda)
    sinSigma = sqrt(pow(cosU2 * sinLambda, 2)
                  + pow(cosU1 * sinU2 - sinU1 * cosU2 * cosLambda, 2))
    if sinSigma == 0 { return 0 }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
    sigma = atan2(sinSigma, cosSigma)
    let sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma
    cosSqAlpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cosSqAlpha == 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha
    let C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
    let previous = lambda
    lambda = L + (1 - C) * f * sinAlpha
      * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
    if abs(lambda - previous) < 1e-14 { break }
  }

  let uSq = cosSqAlpha * (a * a - b * b) / (b * b)
  let A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  let B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  let deltaSigma = B * sinSigma * (cos2SigmaM + B / 4
    * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
       - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma)
         * (-3 + 4 * cos2SigmaM * cos2SigmaM)))
  return b * A * (sigma - deltaSigma)
}

private func metres(_ p: Point) -> Double { sqrt(p.x * p.x + p.y * p.y) / PX_PER_METRE }

@Suite("GeoAnchor")
struct GeoAnchorTests {
  @Test("the origin is the world's origin")
  func originIsZero() {
    let anchor = GeoAnchor(origin: winterthur)
    let p = anchor.world(winterthur)
    #expect(abs(p.x) < 1e-9)
    #expect(abs(p.y) < 1e-9)
  }

  @Test("world +y is south and world +x is east")
  func axes() {
    let anchor = GeoAnchor(origin: winterthur)
    let north = anchor.world(Coordinate(latitude: winterthur.latitude + 0.001,
                                        longitude: winterthur.longitude))
    let east = anchor.world(Coordinate(latitude: winterthur.latitude,
                                       longitude: winterthur.longitude + 0.001))
    #expect(north.y < 0)          // further north is further up the screen
    #expect(abs(north.x) < 1e-9)
    #expect(east.x > 0)
    #expect(abs(east.y) < 1e-9)
  }

  @Test("a degree of longitude is shorter than a degree of latitude at 47.5°")
  func convergence() {
    let anchor = GeoAnchor(origin: winterthur)
    let north = metres(anchor.world(Coordinate(latitude: winterthur.latitude + 0.01,
                                               longitude: winterthur.longitude)))
    let east = metres(anchor.world(Coordinate(latitude: winterthur.latitude,
                                              longitude: winterthur.longitude + 0.01)))
    // cos(47.5°) = 0.6756. This is the factor Web Mercator would have thrown
    // away, and the reason a Mercator projection cannot be used here.
    #expect(abs(east / north - 0.6773) < 0.002)
  }

  @Test("distances agree with the geodesic to within a centimetre over 500m")
  func agreesWithHaversine() {
    let anchor = GeoAnchor(origin: winterthur)
    for (dLat, dLon) in [(0.0, 0.005), (0.004, 0.0), (0.003, 0.004), (-0.002, -0.006)] {
      let there = Coordinate(latitude: winterthur.latitude + dLat,
                             longitude: winterthur.longitude + dLon)
      let mine = metres(anchor.world(there))
      let reference = geodesicMetres(winterthur, there)
      #expect(reference > 100)                     // the cases are worth checking
      #expect(abs(mine - reference) < 0.01)
    }
  }

  @Test("round trips through world coordinates")
  func roundTrip() {
    let anchor = GeoAnchor(origin: winterthur)
    for (dLat, dLon) in [(0.0, 0.0), (0.002, -0.003), (-0.004, 0.005)] {
      let there = Coordinate(latitude: winterthur.latitude + dLat,
                             longitude: winterthur.longitude + dLon)
      let back = anchor.coordinate(anchor.world(there))
      #expect(abs(back.latitude - there.latitude) < 1e-12)
      #expect(abs(back.longitude - there.longitude) < 1e-12)
    }
  }

  @Test("a box of a given side is that many metres across")
  func boxSide() {
    let anchor = GeoAnchor(origin: winterthur)
    let box = anchor.boundingBox(sideMetres: 400)
    let northSouth = geodesicMetres(Coordinate(latitude: box.north, longitude: box.centre.longitude),
                                     Coordinate(latitude: box.south, longitude: box.centre.longitude))
    let eastWest = geodesicMetres(Coordinate(latitude: box.centre.latitude, longitude: box.west),
                                   Coordinate(latitude: box.centre.latitude, longitude: box.east))
    #expect(abs(northSouth - 400) < 0.01)
    #expect(abs(eastWest - 400) < 0.01)
    #expect(box.contains(winterthur))
    #expect(abs(box.centre.latitude - winterthur.latitude) < 1e-12)
  }

  @Test("the scale is the model's own: one metre is PX_PER_METRE")
  func scale() {
    let anchor = GeoAnchor(origin: winterthur)
    // 0.001° of latitude is about 111.2m here; whatever it is, the world
    // distance must be that many metres times the model's own exchange rate.
    let there = Coordinate(latitude: winterthur.latitude + 0.001, longitude: winterthur.longitude)
    let world = anchor.world(there)
    let expected = geodesicMetres(winterthur, there) * PX_PER_METRE
    #expect(abs(abs(world.y) - expected) < 0.56)  // 0.56px is a centimetre
  }
}
/// A map that is a model of a place rather than the place.
///
/// The property that matters is not any one number but that `world` and
/// `coordinate` stay inverses: the Overpass box, the basemap crop and every
/// MapKit route are derived by going back out through `coordinate`, so a ratio
/// applied to one direction only breaks all three at once and silently.
@Suite("Scaled anchors")
struct ScaledAnchorTests {
  private let origin = Coordinate(latitude: 47.4963, longitude: 8.7297)

  @Test("world and coordinate stay inverses at every scale")
  func roundTrips() {
    for scale in [1.0, 2, 5, 10, 20] {
      let anchor = GeoAnchor(origin: origin, scale: scale)
      for p in [Point(0, 0), Point(1234, -567), Point(-8000, 8000)] {
        let back = anchor.world(anchor.coordinate(p))
        #expect(abs(back.x - p.x) < 1e-6, "x at 1:\(Int(scale))")
        #expect(abs(back.y - p.y) < 1e-6, "y at 1:\(Int(scale))")
      }
    }
  }

  @Test("a box of a given side fetches the same earth at every scale")
  func boxIsScaleFree() {
    // If it were not, a 1:10 import would quietly ask Overpass for a tenth of
    // the area -- or ten times it -- while the slider still said 380m.
    let full = GeoAnchor(origin: origin, scale: 1).boundingBox(sideMetres: 380)
    for scale in [2.0, 10, 20] {
      let model = GeoAnchor(origin: origin, scale: scale).boundingBox(sideMetres: 380)
      #expect(abs(model.north - full.north) < 1e-9, "north at 1:\(Int(scale))")
      #expect(abs(model.west - full.west) < 1e-9, "west at 1:\(Int(scale))")
      #expect(abs(model.south - full.south) < 1e-9)
      #expect(abs(model.east - full.east) < 1e-9)
    }
  }

  @Test("a 1:10 map is a tenth of the world units and still reports real metres")
  func tenthOfTheWorld() {
    let life = GeoAnchor(origin: origin, scale: 1)
    let model = GeoAnchor(origin: origin, scale: 10)
    let somewhere = Coordinate(latitude: origin.latitude + 0.001, longitude: origin.longitude)

    let big = life.world(somewhere), small = model.world(somewhere)
    #expect(abs(small.y - big.y / 10) < 1e-6)

    // Both halves of the promise: ten times smaller to walk across, and the
    // same distance when anybody asks how far it is.
    #expect(abs(life.metres(big.y) - model.metres(small.y)) < 1e-6)
    #expect(abs(model.metres(small.y) - big.y / PX_PER_METRE) < 1e-6)
  }

  @Test("the pedestrian does not scale, which is the whole point")
  func bodyIsFixed() {
    // 13 world units is a 0.46m body at 1:1 and a 4.6m giant at 1:10 -- that is
    // the toy town, and it is why the crowd is visible on a real map at all.
    let model = GeoAnchor(origin: origin, scale: 10)
    #expect(abs(model.metres(13) - 13 / PX_PER_METRE * 10) < 1e-9)
  }
}
