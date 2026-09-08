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
    case done(String)
    case failed(String)
  }

  var query: String = ""
  private(set) var phase: Phase = .idle

  /// How wide an import reaches. Held at the measured ceiling rather than a
  /// round number: see `ImportBudget`, and the table in `ios/README.md`.
  var sideMetres: Double = 380

  private let overpass = OverpassClient()

  var isBusy: Bool { phase == .searching || phase == .fetching }

  func importPlace(into world: WalkyWorld, basemap: Basemap, dark: Bool) {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    phase = .searching

    Task {
      do {
        let place = try await find(text)
        let anchor = GeoAnchor(origin: place)
        phase = .fetching

        let box = anchor.boundingBox(sideMetres: sideMetres)
        let footprints = try await overpass.buildings(in: box)
        let polygons = footprintPolygons(footprints, anchor)

        guard !polygons.isEmpty else {
          phase = .failed("OpenStreetMap has no buildings mapped there.")
          return
        }

        // The rebuild is superquadratic in corners, so this is refused rather
        // than survived: past the ceiling it is not a slow import, it is a
        // frozen app on every later wall edit.
        let corners = ImportBudget.vertices(polygons)
        guard ImportBudget.fits(polygons) else {
          phase = .failed("""
            That is \(polygons.count) buildings and \(corners) corners, past the \
            \(ImportBudget.maxVertices) the navigation graph can rebuild quickly. \
            Try a smaller area.
            """)
          return
        }

        world.clearAll()
        world.geoAnchor = anchor
        // One building is one wall of one polygon; the nested shape is for
        // walls that are several bars, like a border frame.
        world.addWalls(polygons.map { [$0] })
        world.resetZoom()

        let half = sideMetres / 2 * PX_PER_METRE
        basemap.snapshot(anchor: anchor,
                         worldRect: CGRect(x: -half, y: -half, width: half * 2, height: half * 2),
                         dark: dark) { [weak self] problem in
          if let problem { self?.phase = .failed(problem) }
        }

        let b = world.contentBounds()
        let acrossM = ((b?.maxX ?? 0) - (b?.minX ?? 0)) / PX_PER_METRE
        phase = .done("\(polygons.count) buildings, \(corners) corners, \(Int(acrossM))m across.")
      } catch let error as OverpassError {
        phase = .failed(describe(error))
      } catch {
        phase = .failed(error.localizedDescription)
      }
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
