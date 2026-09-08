import Foundation
import MapKit
import SwiftUI
import WalkyGeo
import WalkySim

/// Apple's map, as an image the canvas draws rather than a view behind it.
///
/// `MapCanvas` is `Canvas(opaque: true, …)` over an unconditional ground fill,
/// so nothing placed behind it is ever visible, and making it transparent costs
/// a real amount on the Core Graphics path -- every frame, for a feature that
/// is off on a blank map. A snapshot costs nothing per frame: it is drawn in
/// world space after the existing transform, so it pans and zooms with the
/// world for free and a stale one simply scales in place.
///
/// v1 takes **one** snapshot, of the imported area, and never refreshes it.
/// Zoom well past the import and it goes soft, which is the honest cost of not
/// yet having a settle-and-resnapshot rule. See `ios/README.md`.
@MainActor
@Observable
final class Basemap {
  struct Sheet {
    let image: CGImage
    /// Where the image belongs in world units.
    let worldRect: CGRect
  }

  private(set) var sheet: Sheet?
  private var task: Task<Void, Never>?

  func clear() {
    task?.cancel()
    task = nil
    sheet = nil
  }

  /// Snapshot `worldRect`, and place the result by asking the snapshot itself
  /// where two known coordinates landed.
  ///
  /// MapKit adjusts a region to the aspect of the size it is given, so the
  /// image is not necessarily the box that was asked for. Deriving the
  /// placement from `point(for:)` is exact whatever it decided, where assuming
  /// the requested region would put every building off by the adjustment.
  func snapshot(anchor: GeoAnchor, worldRect: CGRect, dark: Bool,
                pixels: CGFloat = 1024, onDone: @escaping (String?) -> Void) {
    task?.cancel()

    let box = anchor.boundingBox(worldMinX: worldRect.minX, worldMinY: worldRect.minY,
                                 worldMaxX: worldRect.maxX, worldMaxY: worldRect.maxY)
    let centre = box.centre
    let options = MKMapSnapshotter.Options()
    options.region = MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: centre.latitude, longitude: centre.longitude),
      span: MKCoordinateSpan(latitudeDelta: box.north - box.south,
                             longitudeDelta: box.east - box.west))
    // The crowd is the subject; the map is the ground it stands on.
    let configuration = MKStandardMapConfiguration(emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    options.preferredConfiguration = configuration
    options.showsBuildings = false
    options.traitCollection = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)

    let aspect = worldRect.height / max(worldRect.width, 1)
    options.size = CGSize(width: pixels, height: max(1, pixels * aspect))

    let topLeft = anchor.coordinate(Point(worldRect.minX, worldRect.minY))
    let bottomRight = anchor.coordinate(Point(worldRect.maxX, worldRect.maxY))

    task = Task { [weak self] in
      let snapshotter = MKMapSnapshotter(options: options)
      do {
        let shot = try await snapshotter.start()
        if Task.isCancelled { return }
        guard let cgImage = shot.image.cgImage else {
          onDone("The map came back without an image."); return
        }

        let a = shot.point(for: CLLocationCoordinate2D(latitude: topLeft.latitude,
                                                       longitude: topLeft.longitude))
        let b = shot.point(for: CLLocationCoordinate2D(latitude: bottomRight.latitude,
                                                       longitude: bottomRight.longitude))
        let spanX = b.x - a.x, spanY = b.y - a.y
        guard abs(spanX) > 0.5, abs(spanY) > 0.5 else {
          onDone("The map placed those two corners on top of each other."); return
        }

        let scaleX = worldRect.width / spanX
        let scaleY = worldRect.height / spanY
        let size = shot.image.size
        self?.sheet = Sheet(image: cgImage, worldRect: CGRect(
          x: worldRect.minX - a.x * scaleX,
          y: worldRect.minY - a.y * scaleY,
          width: size.width * scaleX,
          height: size.height * scaleY))
        onDone(nil)
      } catch {
        if !Task.isCancelled { onDone("Apple's map declined: \(error.localizedDescription)") }
      }
    }
  }
}
