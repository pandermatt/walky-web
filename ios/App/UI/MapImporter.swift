import Foundation
import MapKit
import SwiftUI
import WalkyCore
import WalkyGeo
import WalkySim

/// Turning a place name into a world: find it, fetch its buildings, and put
/// Apple's picture of it underneath.
///
/// Apple supplies two of the three things here and not the third. It finds the
/// place and it draws the ground, but no Apple API returns a building outline
/// -- not MapKit, not the Maps Server API -- and reading one out of the tiles
/// would break the licence. The walls come from OpenStreetMap, as they did in
/// 2016.
@MainActor
@Observable
final class MapImporter {
  enum Phase: Equatable {
    case idle
    case searching
    case fetching
    case merging
    case placing
    /// The visibility rebuild, which is the expensive step and the only one
    /// that cannot report progress -- see `routing` in `fraction`.
    case routing
    case done(String)
    case failed(String)
    /// Past `ImportBudget`, holding everything already fetched so that
    /// importing anyway costs Overpass nothing. It is a free service on a
    /// fair-use policy, and re-querying it to answer a question already
    /// answered is the rudest thing this app could do.
    case refused(String, Ready)
  }

  /// An import that was fetched, merged and refused, kept whole so it can be
  /// placed without touching the network again.
  struct Ready: Equatable {
    var polygons: [[Point]]
    var anchor: GeoAnchor
    var corners: Int
  }

  var query: String = ""
  private(set) var phase: Phase = .idle
  /// How far along, where that can be counted. Nil during a phase whose length
  /// is not knowable -- see `fraction`.
  private(set) var progress: Double?

  /// How wide an import reaches. Held at the measured ceiling rather than a
  /// round number: see `ImportBudget`, and the table in `ios/README.md`.
  var sideMetres: Double = 380

  /// Real metres to one world metre: 10 is a 1:10 model.
  ///
  /// Ten by default, which is not realism but legibility. At 1:1 a pedestrian
  /// is a correctly sized 0.46m and a 380m import is 21,280 world units, so a
  /// person draws at **half a pixel** -- true to life and impossible to watch.
  /// At 1:10 the same person is 4.9pt and the crowd is the thing on screen.
  ///
  /// The price is that obstacle inflation does not scale with the map, so only
  /// streets wider than about `0.93 * scale` metres still admit anybody: 9.3m
  /// here, which is a city block or a campus but not an old-town alley.
  /// `SCALE_SEALS_ABOVE` is where that is said out loud.
  var scale: Double = 10

  /// The ratios worth offering. 1:1 is the truth, 1:10 is the default, and
  /// 1:20 is as far as a crowd can be pushed before the streets close on it.
  static let scaleStops: [Double] = [1, 2, 5, 10, 20]

  /// A pedestrian's body is 2 * 13 world units, and every building is inflated
  /// by another radius on each side, so a street needs `2 * (r + r) / PX_PER_METRE`
  /// world metres -- 0.93 real metres per point of scale -- to admit one person.
  static func sealsBelowMetres(_ scale: Double) -> Double {
    4 * 13 / PX_PER_METRE * scale
  }

  /// What to say about the ratio in hand, or nothing at the default.
  var scaleCaution: String? {
    if scale < 10 {
      // The user's own framing: realism is the expensive direction. The world is
      // wider by the ratio, and `SpatialHash` grids the agents' extent into
      // cells of a fixed size, so the cell count grows with its square.
      return "More realistic, and more expensive: the map is "
        + "\(Int(10 / scale))x wider than 1:10, and pedestrians get small."
    }
    if scale > 10 {
      return "Streets narrower than \(Int(Self.sealsBelowMetres(scale)))m close up at this "
        + "scale, so a crowd may not be able to leave the square it starts in."
    }
    return nil
  }

  private let overpass = OverpassClient()

  var isBusy: Bool {
    switch phase {
    case .searching, .fetching, .merging, .placing, .routing: true
    default: false
    }
  }

  func importPlace(into world: WalkyWorld, basemap: Basemap, dark: Bool) {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    step(.searching)

    Task {
      do {
        let place = try await find(text)
        let anchor = GeoAnchor(origin: place, scale: scale)
        step(.fetching)

        let box = anchor.boundingBox(sideMetres: sideMetres)
        let footprints = try await overpass.buildings(in: box)
        let raw = footprintPolygons(footprints, anchor)

        guard !raw.isEmpty else {
          fail("OpenStreetMap has no buildings mapped there.")
          return
        }

        step(.merging)
        // Fewer, simpler shapes for the same buildings -- and run *before* the
        // budget, so a merge can rescue an import the raw corners would refuse.
        let polygons = mergeFootprints(raw, simplifyTolerance: Self.simplifyTolerance(world))
        let corners = ImportBudget.vertices(polygons)

        // The rebuild is superquadratic in corners, so past the ceiling this is
        // not a slow import but an app that stutters on every later wall edit.
        // That is a warning to carry rather than a decision to make for
        // somebody, so the polygons are kept and the choice is offered.
        guard ImportBudget.fits(polygons) else {
          phase = .refused(refusal(raw: raw, merged: polygons, corners: corners),
                           Ready(polygons: polygons, anchor: anchor, corners: corners))
          progress = nil
          return
        }

        await install(polygons, anchor: anchor, corners: corners,
                      into: world, basemap: basemap, dark: dark)
      } catch let error as OverpassError {
        fail(describe(error))
      } catch {
        fail(error.localizedDescription)
      }
    }
  }

  /// Place an import that was refused, at the cost the refusal named.
  func importAnyway(_ ready: Ready, into world: WalkyWorld, basemap: Basemap, dark: Bool) {
    step(.placing)
    Task {
      await install(ready.polygons, anchor: ready.anchor, corners: ready.corners,
                    into: world, basemap: basemap, dark: dark)
    }
  }

  private func install(_ polygons: [[Point]], anchor: GeoAnchor, corners: Int,
                       into world: WalkyWorld, basemap: Basemap, dark: Bool) async {
    step(.placing)
    world.clearAll()
    world.geoAnchor = anchor
    // One building is one wall of one polygon; the nested shape is for
    // walls that are several bars, like a border frame.
    world.addWalls(polygons.map { [$0] })
    world.resetZoom()
    step(.placing, 1)

    // From the anchor, so the crop follows the ratio the buildings were placed
    // at. Re-deriving it from PX_PER_METRE here is how the ground and the walls
    // would come apart by exactly the scale factor.
    let half = anchor.worldHalfWidth(sideMetres: sideMetres)
    basemap.snapshot(anchor: anchor,
                     worldRect: CGRect(x: -half, y: -half, width: half * 2, height: half * 2),
                     dark: dark) { [weak self] problem in
      // Only the import that started it. This fires asynchronously and could
      // otherwise land on a later import, or on an idle sheet, and report a
      // stale ground failure against something else entirely.
      guard let self, let problem, case .done = self.phase else { return }
      self.phase = .failed(problem)
    }

    // Deliberately here rather than left to the first tick. `addWalls` only
    // sets `navDirty`, so the visibility rebuild -- the superquadratic step the
    // budget exists for -- used to land a moment *after* the sheet said "done",
    // as an unexplained freeze. Paying it here puts it under a label.
    // Awaited rather than blocked on. The rebuild is the superquadratic step
    // the import budget exists for -- 2.1s on a forced 600m map -- and it now
    // runs off this actor, so the sheet stays alive through it and the spinner
    // actually turns. This used to be a 50ms sleep to get the label painted
    // before the main thread stopped answering, which was the best that could
    // be done while the rebuild was synchronous.
    step(.routing)
    await world.navReady()

    let b = world.contentBounds()
    // Real metres, not world ones: the map is a model, and what somebody wants
    // to know is how much of the earth is on it.
    let acrossM = anchor.metres((b?.maxX ?? 0) - (b?.minX ?? 0))
    progress = nil
    phase = .done("""
      \(polygons.count) buildings, \(corners.formatted()) corners, \
      \(Int(acrossM))m across at 1:\(Int(anchor.scale)).
      """)
  }

  private func refusal(raw: [[Point]], merged: [[Point]], corners: Int) -> String {
    let before = ImportBudget.vertices(raw)
    let saved = before > corners
      ? " Merging \(raw.count) buildings into \(merged.count)"
        + " already took it from \(before.formatted())."
      : ""
    return """
      That is \(merged.count) buildings and \(corners.formatted()) corners, past the \
      \(ImportBudget.maxVertices.formatted()) the navigation graph rebuilds quickly.\(saved) \
      A smaller area is the cheap fix; importing anyway keeps every building \
      and makes editing walls slow for as long as the map is loaded.
      """
  }

  /// How far a simplified outline may stray from the surveyed one.
  ///
  /// Half a pedestrian, in world units, rather than a round number of metres.
  /// A tolerance is a promise about what can disappear, and the only promise
  /// worth making here is about the crowd: at half a radius no notch a
  /// pedestrian could stand in, let alone walk through, can be smoothed away.
  /// It lands near 0.12m at the shipped size, well under the half metre that
  /// was measured to take 2% off an ordinary building -- which is the point,
  /// since ordinary buildings are not what this is for.
  private static func simplifyTolerance(_ world: WalkyWorld) -> Double {
    world.settings.pedestrianRadius / 2
  }

  private func step(_ next: Phase, _ fraction: Double? = nil) {
    phase = next
    progress = fraction ?? Self.fraction(of: next)
  }

  private func fail(_ why: String) {
    progress = nil
    phase = .failed(why)
  }

  /// Where a phase sits on the bar.
  ///
  /// Weights rather than measurements, and honest about which is which: the two
  /// network phases cannot report their own length -- `OverpassClient` uses
  /// `data(for:)` rather than `bytes(for:)`, and Overpass rarely sends a
  /// content-length anyway -- so they advance at their boundaries. `routing`
  /// returns nil, which is the bar going indeterminate under its own label,
  /// because the rebuild is one opaque synchronous call and a bar creeping
  /// through it would be invented.
  private static func fraction(of phase: Phase) -> Double? {
    switch phase {
    case .searching: 0.05
    case .fetching: 0.25
    case .merging: 0.55
    case .placing: 0.75
    case .routing: nil
    default: nil
    }
  }

  private func find(_ text: String) async throws -> Coordinate {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = text
    let response = try await MKLocalSearch(request: request).start()
    guard let first = response.mapItems.first else {
      throw CocoaError(.fileNoSuchFile)
    }
    let c = first.placemark.coordinate
    return Coordinate(latitude: c.latitude, longitude: c.longitude)
  }

  private func describe(_ error: OverpassError) -> String {
    switch error {
    case .badStatus(429):
      return "Overpass is rate-limiting. It is a free service on a fair-use policy; wait a moment."
    case .badStatus(let code):
      return "Overpass answered \(code)."
    case .notJSON:
      return "Overpass answered with something that was not JSON."
    }
  }
}
