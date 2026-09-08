import Foundation
import MapKit
import WalkyCore
import WalkyGeo
import WalkySim

/// Apple's walking route, for the half of a measurement Walky cannot answer.
///
/// It lives in the app target because `WalkyCore` carries no framework -- that
/// is what lets the tools and the routing run under plain `swift test` on a
/// machine with no simulator, and importing MapKit there would end it.
///
/// Apple has no building outline to give, so the *geometry* is never Apple's.
/// What it has, and Walky does not, is where the pavements actually go.
@MainActor
@Observable
final class DetourRouter {
  private var task: Task<Void, Never>?

  func cancel() {
    task?.cancel()
    task = nil
  }

  /// A drawn map has no anchor, and nothing for Apple to route on: Walky's own
  /// figure stands alone, which is still a measurement.
  func route(from a: Point, to b: Point, world: WalkyWorld) {
    task?.cancel()
    guard let anchor = world.geoAnchor else { return }

    let from = anchor.coordinate(a)
    let to = anchor.coordinate(b)

    task = Task { [weak world] in
      let request = MKDirections.Request()
      request.transportType = .walking
      request.source = MKMapItem(placemark: MKPlacemark(
        coordinate: CLLocationCoordinate2D(latitude: from.latitude, longitude: from.longitude)))
      request.destination = MKMapItem(placemark: MKPlacemark(
        coordinate: CLLocationCoordinate2D(latitude: to.latitude, longitude: to.longitude)))

      guard let response = try? await MKDirections(request: request).calculate(),
            let route = response.routes.first else { return }
      if Task.isCancelled { return }

      // Converted here, inside the task: only `[Point]` crosses back, and
      // MKRoute is not Sendable.
      let points = Self.worldPoints(route.polyline, anchor)
      guard let first = points.first, let last = points.last else { return }

      // Apple routes from the nearest routable point, not from the tap. The two
      // stubs are added so both figures price the same journey -- without them
      // the ratio compares two different walks and means nothing.
      let stubs = (distance(a, first) + distance(b, last)) / PX_PER_METRE
      let total = route.distance + stubs

      world?.setAppleRoute(a, b, points, total)
    }
  }

  private static func worldPoints(_ line: MKPolyline, _ anchor: GeoAnchor) -> [Point] {
    var coords = [CLLocationCoordinate2D](
      repeating: CLLocationCoordinate2D(), count: line.pointCount)
    line.getCoordinates(&coords, range: NSRange(location: 0, length: line.pointCount))
    return coords.map {
      anchor.world(Coordinate(latitude: $0.latitude, longitude: $0.longitude))
    }
  }
}
