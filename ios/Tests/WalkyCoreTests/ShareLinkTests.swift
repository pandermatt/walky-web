import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// Links, and the one thing in the port that is a bet on a platform API.
///
/// `deflate-raw` in a browser and `COMPRESSION_ZLIB` on Apple's side are
/// supposed to be the same format -- RFC 1951, no zlib wrapper. The name says
/// otherwise, so `opensABrowserMadeLink` inflates a payload the TypeScript
/// actually produced rather than trusting the documentation. If that ever fails,
/// every link shared from the web is unopenable here and nothing else would say
/// so.
@MainActor
@Suite("Share links")
struct ShareLinkTests {
  static let dir = CodecTests.dir

  @Test("a link the web app made opens here, deflate and all")
  func opensABrowserMadeLink() throws {
    let link = try String(contentsOf: Self.dir.appendingPathComponent("deflated.link"),
                          encoding: .utf8)
    #expect(link.hasPrefix(ShareLink.prefix))

    // The header must really say deflated, or this proves nothing.
    let bytes = try Base64Url.decode(try #require(ShareLink.payload(in: link)))
    let (flags, _) = try Codec.readHeader(bytes)
    #expect(flags & Codec.FLAG_DEFLATED != 0, "fixture is not deflated")

    let core = try ShareLink.decode(link)
    #expect(core.agents.count == 400)
    #expect(core.walls.count == 1)
    #expect(core.labels.count == 2)
    #expect(core.generators.count == 2)
    #expect(core.agents[0].color == (255, 200, 0))
    #expect(core.agents.allSatisfy { $0.goal == core.walls[0].id })
  }

  @Test("a link this port makes reads back as the same map")
  func roundTrip() throws {
    let original = try Codec.decode(try CodecTests.bytes("labelsAndGenerators"))
    let core = try ShareLink.decode(ShareLink.encode(original))

    #expect(core.walls == original.walls)
    #expect(core.agents == original.agents)
    #expect(core.generators == original.generators)
    #expect(core.labels.map(\.text) == original.labels.map(\.text))
    #expect(core.view == original.view)
    #expect(core.settings.speed == original.settings.speed)
  }

  /// Deflate earns its place only when it wins. The codec's varints and deltas
  /// have already taken most of the redundancy out, so on a small map deflate's
  /// own header costs more than it saves and the raw bytes go out instead.
  @Test("a small map goes out undeflated, a large one deflated")
  func deflatesOnlyWhenItWins() throws {
    let small = try Codec.decode(try CodecTests.bytes("walls"))
    let smallBytes = try Base64Url.decode(try #require(ShareLink.payload(in: ShareLink.encode(small))))
    #expect(Int(smallBytes[2]) & Codec.FLAG_DEFLATED == 0)

    // A crowd all one colour is exactly what deflate is good at.
    var big = small
    big.agents = (0..<400).map { i -> SerializedAgent in
      let x = Double(i * 3)
      return SerializedAgent(x: x, y: 0, originX: x, originY: 0,
                             goal: -1, arrived: false, color: (255, 200, 0))
    }
    let bigLink = ShareLink.encode(big)
    let bigBytes = try Base64Url.decode(try #require(ShareLink.payload(in: bigLink)))
    #expect(Int(bigBytes[2]) & Codec.FLAG_DEFLATED != 0)
    #expect(bigLink.count < ShareLink.safeChars)

    // And it still reads back.
    #expect(try ShareLink.decode(bigLink).agents.count == 400)
  }

  @Test("the payload is found in a fragment, alongside other keys",
        arguments: [("#m=abc", "abc"), ("m=abc", "abc"), ("#x=1&m=abc", "abc"),
                    ("#m=abc&x=1", "abc"), ("#x=1", nil), ("#m=", nil), ("#", nil)]
                    as [(String, String?)])
  func findsPayload(_ fragment: String, _ expected: String?) {
    #expect(ShareLink.payload(in: fragment) == expected)
  }

  @Test("a URL keeps its query and loses its fragment")
  func strips() {
    #expect(ShareLink.stripFragment("https://x.dev/a?b=1#m=zz") == "https://x.dev/a?b=1")
    #expect(ShareLink.stripFragment("https://x.dev/a") == "https://x.dev/a")
  }

  @Test("an empty or junk payload is refused, not guessed at")
  func refusesJunk() {
    #expect(throws: ScenarioLinkError.self) { try ShareLink.decode("") }
    #expect(throws: ScenarioLinkError.self) { try ShareLink.decode("#x=1") }
    #expect(throws: ScenarioLinkError.self) { try ShareLink.decode("#m=!!!!") }
  }

  /// Deflate is the one step that can turn a small input into a large output, so
  /// the cap on inflated bytes is what stops a crafted link becoming hundreds of
  /// megabytes before the codec's own count checks are ever reached.
  @Test("a payload that unpacks past the ceiling is refused")
  func refusesABomb() throws {
    let zeroes = [UInt8](repeating: 0, count: 4 << 20)
    let bomb = try #require(ShareLink.deflate(zeroes))
    #expect(bomb.count < 20_000, "4MB of zeroes should compress small")
    #expect(ShareLink.inflate(bomb, limit: ShareLink.maxBodyBytes) == nil)
    // And it inflates fine when the ceiling allows it, so the refusal above is
    // the limit talking and not a broken inflate.
    #expect(ShareLink.inflate(bomb, limit: 8 << 20)?.count == zeroes.count)
  }
}
