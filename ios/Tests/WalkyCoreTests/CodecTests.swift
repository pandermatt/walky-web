import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// The codec against V8's own output.
///
/// Each fixture is a scenario encoded by `web/tools/codecFixtures.ts`. Decoding
/// it and re-encoding has to give the identical bytes back, which checks the
/// decoder and the encoder against each other *and* both of them against the
/// TypeScript in one comparison. A handful of spot values guard the case a
/// round-trip cannot catch on its own: a systematic mis-decode that happens to
/// re-encode to the same bytes.
///
/// Exact bytes, no tolerance -- the same currency the trace fixtures trade in.
@MainActor
@Suite("Codec agrees with V8")
struct CodecTests {
  static let dir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().appendingPathComponent("Fixtures/codec")

  struct Expected: Decodable {
    let bytes: Int
    let walls: Int
    let agents: Int
    let labels: Int
    let generators: Int
    let speed: Double
    let zoomLevel: Double
    let firstWallId: Int?
    let lastLabelText: String?
  }

  static let index: [String: Expected] = {
    let url = dir.appendingPathComponent("index.json")
    let data = try! Data(contentsOf: url)
    return try! JSONDecoder().decode([String: Expected].self, from: data)
  }()

  static func bytes(_ name: String) throws -> [UInt8] {
    [UInt8](try Data(contentsOf: dir.appendingPathComponent("\(name).wkcd")))
  }

  @Test("every fixture decodes and re-encodes to the identical bytes",
        arguments: ["empty", "settings", "walls", "agents", "labelsAndGenerators"])
  func roundTrip(_ name: String) throws {
    let original = try Self.bytes(name)
    let expected = try #require(Self.index[name])
    #expect(original.count == expected.bytes)

    let core = try Codec.decode(original)
    #expect(core.walls.count == expected.walls)
    #expect(core.agents.count == expected.agents)
    #expect(core.labels.count == expected.labels)
    #expect(core.generators.count == expected.generators)
    #expect(core.settings.speed == expected.speed)
    #expect(core.view.zoomLevel == expected.zoomLevel)
    #expect(core.walls.first?.id == expected.firstWallId)
    #expect(core.labels.last?.text == expected.lastLabelText)

    let again = Codec.encode(core)
    #expect(again == original, "\(name) re-encoded to \(again.count) bytes, not \(original.count)")
  }

  /// The fixture's fractional vertex, as V8 rounded it on the way out.
  ///
  /// This checks the *fixture*, not Swift's rounding: by the time the port
  /// re-encodes, the coordinate it read back is already whole, so no half-way
  /// value passes through the writer. The rule itself is pinned below.
  @Test("a fractional vertex arrives already rounded, the way V8 rounded it")
  func fractionalVertex() throws {
    let core = try Codec.decode(try Self.bytes("walls"))
    let triangle = try #require(core.walls.first { $0.id == 8 })
    #expect(triangle.polygons[0][0] == Point(-1, -2))
  }

  /// `Math.round` is half-**up**; Swift's `.rounded()` is half-away-from-zero.
  /// They agree on every positive value and disagree on every negative half-way
  /// one, so a port written with `.rounded()` encodes a map drawn left of the
  /// origin to different bytes -- and every test above would still pass, because
  /// a decoded coordinate is whole before it is written again.
  ///
  /// The numbers are V8's, read straight off `Math.round` and the zigzag in
  /// `codec.ts:172`.
  @Test("the writer rounds half-way values the way JavaScript does",
        arguments: [(-1.5, 1), (-2.5, 3), (-0.5, 0), (0.5, 2), (2.5, 6)] as [(Double, UInt8)])
  func writerRoundsHalfUp(_ value: Double, _ expected: UInt8) {
    var w = Writer()
    w.zigzag(value)
    #expect(w.bytes == [expected], "zigzag(\(value))")
  }

  /// Every agent bit, read back off the wire.
  @Test("the agent flag byte survives the trip")
  func agentBits() throws {
    let core = try Codec.decode(try Self.bytes("agents"))
    #expect(core.agents.count == 4)

    // Unmoved: no origin on the wire, so it comes back equal to the position.
    #expect(core.agents[0].originX == core.agents[0].x)
    // The colour-repeat bit: the second wears the first's colour.
    #expect(core.agents[1].color == core.agents[0].color)
    // Moved, arrived, spawned, new colour.
    #expect(core.agents[2].arrived)
    #expect(core.agents[2].spawned)
    #expect(core.agents[2].originX == 120)
    #expect(core.agents[2].color == (66, 158, 214))
    // A goal naming no wall is dropped rather than refused.
    #expect(core.agents[3].goal == -1)
  }

  @Test("a label's astral-plane text comes back intact")
  func labelText() throws {
    let core = try Codec.decode(try Self.bytes("labelsAndGenerators"))
    #expect(core.labels[0].text == "Hauptbahnhof")
    #expect(core.labels[1].text.hasPrefix("Ausgang"))
    #expect(core.generators[1].goal == -1)
  }

  // MARK: - what a hostile link cannot do

  @Test("a payload that is not Walky's is refused by name")
  func rejectsForeign() {
    #expect(throws: ScenarioLinkError.self) { try Codec.decode([0x58, 3, 0]) }
  }

  @Test("a version this build does not know is refused in both directions")
  func rejectsVersion() {
    #expect(throws: ScenarioLinkError.self) { try Codec.decode([Codec.MAGIC, 2, 0]) }
    #expect(throws: ScenarioLinkError.self) { try Codec.decode([Codec.MAGIC, 4, 0]) }
  }

  @Test("an unknown flag bit is refused rather than ignored")
  func rejectsUnknownFlag() {
    #expect(throws: ScenarioLinkError.self) { try Codec.decode([Codec.MAGIC, Codec.VERSION, 0x80]) }
  }

  @Test("bytes left over after everything decoded are an error, not a shrug")
  func rejectsTrailingBytes() throws {
    let good = try Self.bytes("empty")
    #expect(throws: ScenarioLinkError.self) { try Codec.decode(good + [0]) }
  }

  @Test("a truncated payload is refused")
  func rejectsTruncated() throws {
    let good = try Self.bytes("walls")
    #expect(throws: ScenarioLinkError.self) { try Codec.decode(Array(good.dropLast())) }
  }

  /// Fatal rather than lossy: `String(decoding:as:UTF8.self)` would have
  /// substituted U+FFFD here and carried on, which is precisely the silent
  /// corruption the TypeScript's `{fatal: true}` exists to refuse.
  @Test("invalid UTF-8 in a label is fatal, not replaced")
  func rejectsBadUTF8() throws {
    var bytes = try Self.bytes("labelsAndGenerators")
    // 0xC3 0x28 is a truncated two-byte sequence: valid lead, invalid tail.
    if let at = bytes.firstIndex(of: UInt8(ascii: "H")) {   // "Hauptbahnhof"
      bytes[at] = 0xC3
      bytes[at + 1] = 0x28
    }
    #expect(throws: ScenarioLinkError.self) { try Codec.decode(bytes) }
  }

  // MARK: - base64url

  @Test("base64url round-trips every byte value, at every length mod 3")
  func base64RoundTrip() throws {
    for length in 0...260 {
      let bytes = (0..<length).map { UInt8($0 % 256) }
      let text = Base64Url.encode(bytes)
      #expect(!text.contains("=") && !text.contains("+") && !text.contains("/"))
      #expect(try Base64Url.decode(text) == bytes)
    }
  }

  @Test("base64url refuses a character outside its alphabet")
  func base64RejectsJunk() {
    #expect(throws: ScenarioLinkError.self) { try Base64Url.decode("abc!") }
  }

  /// Four characters carry three bytes, so a single trailing character carries
  /// none: a length of that shape can only be damage.
  @Test("base64url refuses a length that cannot be right")
  func base64RejectsLength() {
    #expect(throws: ScenarioLinkError.self) { try Base64Url.decode("abcde") }
  }
}
