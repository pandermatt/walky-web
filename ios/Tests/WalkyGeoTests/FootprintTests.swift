import Testing
import Foundation
import WalkySim
@testable import WalkyGeo

private let winterthur = Coordinate(latitude: 47.496345, longitude: 8.729700)

/// Two buildings as Overpass returns them, closing ring and all. The shape of
/// this payload is the contract; the numbers are a real corner of Büelrain.
private let sample = Data("""
{"version":0.6,"elements":[
 {"type":"way","id":1,"tags":{"building":"yes","name":"Büelrain"},"geometry":[
   {"lat":47.4960,"lon":8.7295},{"lat":47.4960,"lon":8.7300},
   {"lat":47.4963,"lon":8.7300},{"lat":47.4963,"lon":8.7295},
   {"lat":47.4960,"lon":8.7295}]},
 {"type":"way","id":2,"tags":{"building":"house"},"geometry":[
   {"lat":47.4965,"lon":8.7295},{"lat":47.4965,"lon":8.7298},
   {"lat":47.4967,"lon":8.7298},{"lat":47.4965,"lon":8.7295}]},
 {"type":"way","id":3,"tags":{"building":"yes"},"geometry":[
   {"lat":47.4970,"lon":8.7295},{"lat":47.4970,"lon":8.7296}]}
]}
""".utf8)

@Suite("Overpass")
struct OverpassTests {
  @Test("decodes ways with inline geometry")
  func decodes() throws {
    let footprints = try OverpassClient.decode(sample)
    // The two-node way is not a building outline and is dropped.
    #expect(footprints.count == 2)
    #expect(footprints[0].name == "Büelrain")
    #expect(footprints[1].name == nil)
    #expect(footprints[0].ring.count == 5)      // still closed at this stage
  }

  @Test("rejects a body that is not Overpass JSON")
  func rejectsGarbage() {
    #expect(throws: OverpassError.notJSON) { try OverpassClient.decode(Data("<html>".utf8)) }
  }

  @Test("asks for buildings in the box, and nothing else")
  func query() {
    let client = OverpassClient()
    let q = client.query(BoundingBox(south: 47.49, west: 8.72, north: 47.50, east: 8.73))
    #expect(q.contains("[out:json]"))
    #expect(q.contains("way[\"building\"]"))
    #expect(q.contains("(47.49,8.72,47.5,8.73)"))
    #expect(q.hasSuffix("out geom;"))
  }

  @Test("posts the query form-encoded")
  func request() throws {
    let client = OverpassClient()
    let request = client.request(BoundingBox(south: 47.49, west: 8.72, north: 47.50, east: 8.73))
    #expect(request.httpMethod == "POST")
    let body = try #require(request.httpBody).map { $0 }
    let text = String(decoding: body, as: UTF8.self)
    #expect(text.hasPrefix("data="))
    #expect(!text.contains(" "))               // percent-encoded, or Overpass 400s
    #expect(!text.contains("\""))
  }
}

@Suite("Footprints")
struct FootprintTests {
  @Test("drops the repeated closing vertex")
  func closingVertex() throws {
    let footprints = try OverpassClient.decode(sample)
    let anchor = GeoAnchor(origin: winterthur)
    let polygons = footprintPolygons(footprints, anchor)
    #expect(polygons.count == 2)
    #expect(polygons[0].count == 4)            // was 5 on the wire
    #expect(polygons[1].count == 3)
    for ring in polygons {
      #expect(ring.first != ring.last)
    }
  }

  @Test("a triangle whose vertices coincide is not a wall")
  func degenerate() {
    let anchor = GeoAnchor(origin: winterthur)
    let line = Footprint(ring: [winterthur,
                                Coordinate(latitude: 47.4970, longitude: 8.7296),
                                winterthur])
    #expect(footprintPolygons([line], anchor).isEmpty)
  }

  @Test("a building lands where the projection says, at the model's scale")
  func placement() throws {
    let footprints = try OverpassClient.decode(sample)
    let anchor = GeoAnchor(origin: winterthur)
    let ring = footprintPolygons(footprints, anchor)[0]

    // The first building is south-west of the anchor, so +y (south) and -x.
    #expect(ring[0].y > 0)
    #expect(ring[0].x < 0)

    // Its east-west side spans 0.0005 degrees of longitude. At 56px to the
    // metre that is a building about 37m wide -- the width of a school block.
    let width = abs(ring[1].x - ring[0].x) / PX_PER_METRE
    #expect(abs(width - 37.6) < 0.5)
  }

  @Test("the import budget counts corners, not buildings")
  func budget() {
    let square = [Point(0, 0), Point(10, 0), Point(10, 10), Point(0, 10)]
    #expect(ImportBudget.vertices(Array(repeating: square, count: 100)) == 400)
    #expect(ImportBudget.fits(Array(repeating: square, count: 100)))
    // 1,000 corners is the measured ceiling; 251 squares is 1,004.
    #expect(!ImportBudget.fits(Array(repeating: square, count: 251)))
  }
}
