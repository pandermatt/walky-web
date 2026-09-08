import Foundation

public enum OverpassError: Error, Equatable, Sendable {
  case badStatus(Int)
  case notJSON
}

/// Building footprints from the OpenStreetMap Overpass API.
///
/// Apple has no building geometry to give: neither MapKit, MapKit JS nor the
/// Apple Maps Server API returns a footprint, and reading one out of the tiles
/// would break the licence. The outlines come from OpenStreetMap, as they did
/// in 2016 -- what has changed is that they arrive over the wire instead of
/// from a committed `.osm` file.
///
/// `out geom` inlines each way's ring, so there is no node table to resolve.
/// That is the whole of `OpenStreetMapParser`'s sorted-node binary search, and
/// it simply does not need to exist any more.
public struct OverpassClient: Sendable {
  /// Tried in order.
  ///
  /// Not belt and braces: the main instance is a free service under permanent
  /// load and answers 504 often enough that a single endpoint makes the import
  /// look broken when it is merely busy -- which is exactly what happened the
  /// first time this ran against a real place. A mirror is the difference
  /// between "try again later" and "try again".
  public static let publicEndpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ].map { URL(string: $0)! }

  public var endpoints: [URL]
  public var timeoutSeconds: Int

  public init(endpoints: [URL] = OverpassClient.publicEndpoints, timeoutSeconds: Int = 25) {
    self.endpoints = endpoints.isEmpty ? OverpassClient.publicEndpoints : endpoints
    self.timeoutSeconds = timeoutSeconds
  }

  public var endpoint: URL { endpoints[0] }

  /// Ways tagged `building`, any value -- the same test the 2016 parser made.
  ///
  /// Relations are not asked for. A building mapped as a multipolygon (a
  /// courtyard, mostly) is a minority of a minority, and the ones that exist
  /// come back from their outer ways anyway.
  public func query(_ box: BoundingBox) -> String {
    let bbox = "\(box.south),\(box.west),\(box.north),\(box.east)"
    return "[out:json][timeout:\(timeoutSeconds)];way[\"building\"](\(bbox));out geom;"
  }

  public func request(_ box: BoundingBox, _ endpoint: URL? = nil) -> URLRequest {
    var request = URLRequest(url: endpoint ?? self.endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let allowed = CharacterSet.alphanumerics.union(.init(charactersIn: "-._~"))
    let escaped = query(box).addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    request.httpBody = Data("data=\(escaped)".utf8)
    return request
  }

  public func buildings(in box: BoundingBox,
                        using session: URLSession = .shared) async throws -> [Footprint] {
    var lastError: Error = OverpassError.badStatus(0)
    for endpoint in endpoints {
      do {
        let (data, response) = try await session.data(for: request(box, endpoint))
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
          // 429 is the fair-use policy being enforced, and it is an answer
          // rather than a hiccup: asking a mirror the same question straight
          // afterwards is the behaviour the policy exists to stop.
          if http.statusCode == 429 { throw OverpassError.badStatus(429) }
          lastError = OverpassError.badStatus(http.statusCode)
          continue
        }
        return try Self.decode(data)
      } catch let error as OverpassError {
        if case .badStatus(429) = error { throw error }
        lastError = error
      } catch {
        lastError = error       // transport: this mirror is unreachable
      }
    }
    throw lastError
  }

  // MARK: - The wire format

  private struct Response: Decodable {
    struct Node: Decodable { let lat: Double; let lon: Double }
    struct Element: Decodable {
      let type: String?
      let geometry: [Node]?
      let tags: [String: String]?
    }
    let elements: [Element]
  }

  public static func decode(_ data: Data) throws -> [Footprint] {
    guard let response = try? JSONDecoder().decode(Response.self, from: data) else {
      throw OverpassError.notJSON
    }
    return response.elements.compactMap { element in
      guard let geometry = element.geometry, geometry.count >= 4 else { return nil }
      return Footprint(ring: geometry.map { Coordinate(latitude: $0.lat, longitude: $0.lon) },
                       name: element.tags?["name"])
    }
  }
}
