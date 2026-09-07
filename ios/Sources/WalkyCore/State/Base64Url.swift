import Foundation

/// base64url, unpadded: the alphabet that rides in a URL fragment untouched --
/// no percent-encoding, no `+`, `/` or `=`. Ports `state/codec.ts:650`.
///
/// Hand-rolled rather than `Data.base64EncodedString()` plus substitutions,
/// which is what the TypeScript does and for a related reason: Foundation's
/// encoder emits the standard alphabet with padding, so every call would need
/// three string rewrites afterwards, and the decode side would have to put the
/// padding back before it could refuse a bad character. Doing it directly keeps
/// one table and one pass, and keeps the two ports diffable line by line.
public enum Base64Url {
  static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

  /// Values by ASCII code, -1 for anything not in the alphabet.
  static let values: [Int8] = {
    var map = [Int8](repeating: -1, count: 128)
    for (i, c) in alphabet.enumerated() { map[Int(c)] = Int8(i) }
    return map
  }()

  public static func encode(_ bytes: [UInt8]) -> String {
    var out: [UInt8] = []
    out.reserveCapacity((bytes.count + 2) / 3 * 4)
    var i = 0
    while i < bytes.count {
      let a = Int(bytes[i])
      let b = i + 1 < bytes.count ? Int(bytes[i + 1]) : 0
      let c = i + 2 < bytes.count ? Int(bytes[i + 2]) : 0
      let chunk = (a << 16) | (b << 8) | c
      let left = bytes.count - i
      out.append(alphabet[(chunk >> 18) & 63])
      out.append(alphabet[(chunk >> 12) & 63])
      if left > 1 { out.append(alphabet[(chunk >> 6) & 63]) }
      if left > 2 { out.append(alphabet[chunk & 63]) }
      i += 3
    }
    return String(decoding: out, as: UTF8.self)
  }

  public static func decode(_ text: String) throws -> [UInt8] {
    let chars = Array(text.unicodeScalars)
    // Four characters carry three bytes; a single trailing character carries
    // none, so a length of that shape can only be damage.
    if chars.count % 4 == 1 { throw ScenarioLinkError.truncated }
    var out: [UInt8] = []
    out.reserveCapacity(chars.count * 3 / 4)
    var chunk = 0
    var bits = 0
    for scalar in chars {
      let code = Int(scalar.value)
      let value = code < 128 ? Int(values[code]) : -1
      if value < 0 { throw ScenarioLinkError.notWalky }
      chunk = (chunk << 6) | value
      bits += 6
      if bits >= 8 {
        bits -= 8
        out.append(UInt8((chunk >> bits) & 0xff))
      }
    }
    return out
  }
}
