import Foundation
import WalkySim

/// The map as a compact byte string, so it fits in a URL.
/// Ports `web/src/state/codec.ts`.
///
/// Three things buy the size: varints, because almost every number in a map is
/// small; deltas, because one running cursor walks every wall vertex and another
/// walks the crowd, so a map drawn far from the origin costs no more than one
/// drawn on it; and no floats, because every wall vertex and pedestrian position
/// is already a whole number. Only the camera is fractional, and it gets just
/// enough sub-unit precision to be invisible.
///
/// Because there is no float on the wire, NaN and Infinity are unrepresentable:
/// a whole class of bad input cannot be expressed, let alone decoded.
public enum Codec {
  /// 'W'. A payload that does not start with this was not made by Walky.
  static let MAGIC: UInt8 = 0x57

  /// The wire format's own version, independent of `SCENARIO_VERSION`.
  ///
  /// Unknown versions are rejected in *both* directions -- a payload from before
  /// a field was dropped misreads exactly as badly as one from after a field was
  /// added, and over a delta stream a field whose length you do not know cannot
  /// be skipped. Additive changes go in the flags byte instead.
  public static let VERSION: UInt8 = 3

  public static let FLAG_DEFLATED = 1
  public static let FLAG_LABELS = 2
  public static let FLAG_GENERATORS = 4
  /// Speed rides as round(m/s * 100). Always set by this build: there is no
  /// whole number of px/tick that says 1.35 m/s. Without it the payload is an
  /// old one and its whole number is px/tick, converted on the way in.
  public static let FLAG_SPEED_MPS = 8

  static let KNOWN_FLAGS = FLAG_DEFLATED | FLAG_LABELS | FLAG_GENERATORS | FLAG_SPEED_MPS

  /// Sub-unit precision for the one thing in a map that is not a whole number.
  static let VIEW_QUANTUM: Double = 16   // at the deepest zoom, under 4px
  static let ZOOM_QUANTUM: Double = 256  // a pinch lands between the wheel's notches

  static let AGENT_ARRIVED = 1
  static let AGENT_ORIGIN_DIFFERS = 2
  static let AGENT_COLOR_REPEATS = 4
  static let AGENT_SPAWNED = 8

  static let WALL_IS_GOAL = 1
  static let WALL_IS_BORDER = 2
}

/// Ceilings on the payload, checked before anything is allocated.
///
/// A link is untrusted input: without these, five bytes claiming four billion
/// pedestrians would be an out-of-memory crash rather than an error message.
///
/// `maxTotalPoints` is the load-bearing one rather than a formality: the
/// visibility graph is O(n^2) over wall corners, so a link that decodes in
/// milliseconds can lock the app up for minutes on the rebuild that follows.
public enum CodecLimits {
  public static let maxWalls = 2_000
  public static let maxPolygonsPerWall = 64
  public static let maxPointsPerPolygon = 4_096
  public static let maxTotalPoints = 20_000
  public static let maxAgents = 100_000
  public static let maxLabels = 500
  public static let maxGenerators = 500
  public static let maxLabelBytes = 512
  /// Well inside the range where a Float32 still holds integers exactly.
  public static let maxCoord = 1 << 22
}

/// A link that cannot be read, with a sentence that can be shown to a person.
public struct ScenarioLinkError: Error, Equatable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }

  static let truncated = ScenarioLinkError("that link is cut short or damaged")
  static let notWalky = ScenarioLinkError("that does not look like a Walky link")
  static let wrongVersion = ScenarioLinkError("that link was made by a different version of Walky")
}

// MARK: - bytes out

struct Writer {
  private(set) var bytes: [UInt8] = []

  mutating func byte(_ v: Int) { bytes.append(UInt8(truncatingIfNeeded: v)) }

  /// LEB128: seven bits per byte, high bit set while more follow.
  ///
  /// Division rather than shifting, exactly as the TypeScript does, because the
  /// value there is a double and may exceed 32 bits.
  mutating func varint(_ v: Double) {
    var n = jsMax(0, jsRound(v))
    while n >= 128 {
      bytes.append(UInt8(truncatingIfNeeded: Int(n.truncatingRemainder(dividingBy: 128))) | 0x80)
      n = (n / 128).rounded(.down)
    }
    bytes.append(UInt8(truncatingIfNeeded: Int(n)))
  }

  mutating func varint(_ v: Int) { varint(Double(v)) }

  /// Zigzag, so a small negative delta costs one byte like a small positive one.
  mutating func zigzag(_ v: Double) {
    let n = jsRound(v)
    varint(n < 0 ? -2 * n - 1 : 2 * n)
  }

  mutating func rgb(_ c: RGB) { byte(c.r); byte(c.g); byte(c.b) }

  /// UTF-8, length first: the bytes, not the characters, since that is what is
  /// read back.
  mutating func string(_ v: String) {
    let utf8 = Array(v.utf8)
    varint(utf8.count)
    bytes.append(contentsOf: utf8)
  }
}

// MARK: - bytes in

struct Reader {
  private let bytes: [UInt8]
  private var at = 0
  /// Ring points seen so far, against `maxTotalPoints`.
  private var points = 0

  init(_ bytes: [UInt8]) { self.bytes = bytes }

  var done: Bool { at >= bytes.count }

  mutating func byte() throws -> Int {
    guard at < bytes.count else { throw ScenarioLinkError.truncated }
    defer { at += 1 }
    return Int(bytes[at])
  }

  mutating func varint() throws -> Double {
    var shift: Double = 1
    var out: Double = 0
    while true {
      let b = try byte()
      out += Double(b & 0x7f) * shift
      if b & 0x80 == 0 { return out }
      shift *= 128
      // Past this a varint can no longer be an exact integer, so it is
      // corruption rather than a number: stop before the value goes quietly
      // wrong. 9007199254740991 is Number.MAX_SAFE_INTEGER.
      if shift > 9_007_199_254_740_991 { throw ScenarioLinkError.truncated }
    }
  }

  mutating func zigzag() throws -> Double {
    let n = try varint()
    return n.truncatingRemainder(dividingBy: 2) == 0 ? n / 2 : -(n + 1) / 2
  }

  mutating func rgb() throws -> RGB { (try byte(), try byte(), try byte()) }

  /// A length-prefixed UTF-8 string, refused by length before it is read.
  ///
  /// **Fatal rather than lossy on bad bytes.** `String(decoding:as:UTF8.self)`
  /// would silently substitute U+FFFD exactly where the TypeScript's
  /// `TextDecoder({fatal: true})` throws; a label that decodes to replacement
  /// characters is a damaged link, and the rest of the payload after it cannot
  /// be trusted either.
  mutating func string(limit: Int) throws -> String {
    let length = Int(try varint())
    if length > limit {
      throw ScenarioLinkError("that link claims a longer label than Walky can hold")
    }
    guard at + length <= bytes.count else { throw ScenarioLinkError.truncated }
    let slice = Array(bytes[at..<(at + length)])
    at += length
    guard let text = String(bytes: slice, encoding: .utf8) else {
      throw ScenarioLinkError.truncated
    }
    return text
  }

  /// A count, refused before it is used to size anything.
  mutating func count(_ limit: Int, _ what: String) throws -> Int {
    let n = try varint()
    if n > Double(limit) {
      throw ScenarioLinkError("that link claims more \(what) than Walky can hold")
    }
    return Int(n)
  }

  /// A cursor step. Each delta on its own can be legal while the running total
  /// walks off to a billion, so the *position* is checked rather than the step.
  mutating func step(_ from: Double) throws -> Double {
    let to = from + (try zigzag())
    guard abs(to) <= Double(CodecLimits.maxCoord) else {
      throw ScenarioLinkError("that link is off the map")
    }
    return to
  }

  mutating func ring(_ n: Int) throws {
    points += n
    if points > CodecLimits.maxTotalPoints {
      throw ScenarioLinkError("that link claims more points than Walky can hold")
    }
  }
}
