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
        let anchor = GeoAnchor(origin: place)
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

    let half = sideMetres / 2 * PX_PER_METRE
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
    step(.routing)
    // The rebuild is synchronous on the main actor, so this pause is what puts
    // the label on screen before the thread stops answering. `Task.yield()` is
    // not enough and was tried: it reschedules this task but does not make the
    // run loop *draw*, so on device the label stayed on "Placing the
    // buildings..." right through the rebuild. A frame is what is needed, and
    // one frame is what this waits for.
    //
    // The spinner still will not animate through the rebuild -- making it do so
    // is the deferred work of moving the tick off the main actor -- but a
    // stationary, correct label beats a frozen app with nothing to explain it.
    try? await Task.sleep(for: .milliseconds(50))
    world.prepareForRender()

    let b = world.contentBounds()
    let acrossM = ((b?.maxX ?? 0) - (b?.minX ?? 0)) / PX_PER_METRE
    progress = nil
    phase = .done("""
      \(polygons.count) buildings, \(corners.formatted()) corners, \(Int(acrossM))m across.
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
