import Compression
import Foundation
import WalkySim

/// The map as a link, and back. Ports `web/src/state/shareLink.ts`.
///
/// The payload rides in the fragment rather than the query string. A fragment is
/// never sent in the request, so a large map never becomes a large request line
/// in somebody's access log, no host or CDN limit applies, and nothing about the
/// map leaves the device -- which for a project whose README says "no backend,
/// no analytics and no third-party anything" is the point rather than a detail.
///
/// The fragment is parsed as `&`-separated `key=value`, so a second key can be
/// added later without breaking a link already pasted somewhere.
public enum ShareLink {
  public static let key = "m"
  public static let prefix = "#m="

  /// The length that works everywhere without thinking about it -- the old IE
  /// address-bar limit, and therefore the number third-party link handling is
  /// actually tested against.
  public static let safeChars = 2_000

  /// Past Chromium's practical URL ceiling. A link this long is not a link any
  /// more, and handing over one that silently fails to open is worse than
  /// saying so.
  public static let maxChars = 32_000

  /// What an inflated body is allowed to come to.
  ///
  /// Deflate is the one step here that can turn a small input into a large
  /// output, so the codec's caps on counts have to be matched by a cap on the
  /// bytes those counts are read from -- otherwise a kilobyte of crafted zeroes
  /// becomes hundreds of megabytes before the first count is ever checked.
  public static let maxBodyBytes = 1 << 20

  // MARK: - writing

  /// The fragment for a map: `#m=` followed by base64url.
  ///
  /// Deflated only when that actually comes out shorter. The codec's varints and
  /// deltas have already taken most of the redundancy out, so on a small map
  /// deflate's own header can cost more than it saves.
  public static func encode(_ core: ScenarioCore) -> String {
    // The same bytes a `.walky` file holds, base64'd. A link and a file differ
    // by that and nothing else -- see `MapFile`.
    prefix + Base64Url.encode(MapFile.bytes(core))
  }

  /// The whole shareable URL for a map: this page, with the map in its fragment.
  public static func url(_ core: ScenarioCore, base href: String) -> String {
    stripFragment(href) + encode(core)
  }

  // MARK: - reading

  /// A payload back into a map. Takes the value alone, as `payload(in:)` returns
  /// it, or a whole fragment, as someone pasting a link would have.
  public static func decode(_ payload: String) throws -> ScenarioCore {
    let text = payload.hasPrefix("#")
      ? (self.payload(in: payload) ?? "")
      : payload.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { throw ScenarioLinkError.notWalky }

    return try MapFile.read(try Base64Url.decode(text))
  }

  /// The map's payload out of a fragment, or nil when there is none.
  ///
  /// A pure string function so that the URL never has to enter a type the tests
  /// cannot reach. Garbage is returned rather than filtered: the decoder is the
  /// validator, and a parser that guessed would only make its errors vaguer.
  public static func payload(in fragment: String) -> String? {
    let text = fragment.hasPrefix("#") ? String(fragment.dropFirst()) : fragment
    for part in text.split(separator: "&", omittingEmptySubsequences: false) {
      guard let at = part.firstIndex(of: "="), at > part.startIndex else { continue }
      if part[part.startIndex..<at] == key {
        let value = String(part[part.index(after: at)...])
        return value.isEmpty ? nil : value
      }
    }
    return nil
  }

  /// A URL with its fragment removed, query intact.
  public static func stripFragment(_ href: String) -> String {
    String(href.prefix(while: { $0 != "#" }))
  }

  // MARK: - deflate

  /// `COMPRESSION_ZLIB` is Apple's name for **raw DEFLATE** -- RFC 1951, no zlib
  /// wrapper and no checksum -- which is exactly what the web's
  /// `CompressionStream('deflate-raw')` writes. The name is the only confusing
  /// thing about it, and `ShareLinkTests` inflates a payload the TypeScript
  /// produced rather than taking the documentation's word for it.
  static let algorithm = COMPRESSION_ZLIB

  static func deflate(_ input: [UInt8]) -> [UInt8]? {
    if input.isEmpty { return nil }
    // Deflate can expand incompressible input slightly; the slack covers that,
    // and a return of 0 (which also means "did not fit") falls back to raw.
    var out = [UInt8](repeating: 0, count: input.count + 64)
    let n = out.withUnsafeMutableBufferPointer { dst in
      input.withUnsafeBufferPointer { src in
        compression_encode_buffer(dst.baseAddress!, dst.count,
                                  src.baseAddress!, src.count, nil, algorithm)
      }
    }
    guard n > 0 else { return nil }
    return Array(out[0..<n])
  }

  /// Inflates within a ceiling.
  ///
  /// The buffer grows rather than starting at the cap, so an ordinary link does
  /// not reserve a megabyte to decode a kilobyte. Filling the cap exactly is
  /// treated as over the limit: `compression_decode_buffer` cannot say whether
  /// it stopped because it was finished or because it ran out of room, and a
  /// map read to exactly the ceiling is the case where that matters.
  static func inflate(_ input: [UInt8], limit: Int) -> [UInt8]? {
    if input.isEmpty { return nil }
    var capacity = max(input.count * 4, 1024)
    while true {
      capacity = min(capacity, limit)
      var out = [UInt8](repeating: 0, count: capacity)
      let n = out.withUnsafeMutableBufferPointer { dst in
        input.withUnsafeBufferPointer { src in
          compression_decode_buffer(dst.baseAddress!, dst.count,
                                    src.baseAddress!, src.count, nil, algorithm)
        }
      }
      if n == 0 { return nil }
      if n < capacity { return Array(out[0..<n]) }
      if capacity >= limit { return nil }   // filled the ceiling: refuse it
      capacity *= 4
    }
  }
}
