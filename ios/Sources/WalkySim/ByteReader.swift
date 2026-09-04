import Foundation

/// Little-endian reads over a `Data`, with bounds that fail loudly.
///
/// Every fixture in this project is binary because a decimal round-trip hides
/// exactly the last-bit differences the port is being checked for. That makes
/// the reader load-bearing: a misread offset would look like a divergence in
/// the model rather than a bug here, which is the most expensive kind of wrong
/// answer this project can produce.
public struct ByteReader {
  public enum Err: Error, CustomStringConvertible {
    case truncated(needed: Int, at: Int, of: Int)
    case badMagic(got: UInt32, want: UInt32)
    case badVersion(got: UInt32, want: UInt32)
    case checksum

    public var description: String {
      switch self {
      case let .truncated(n, at, of): "truncated: wanted \(n) bytes at \(at) of \(of)"
      case let .badMagic(got, want): "bad magic 0x\(String(got, radix: 16)), expected 0x\(String(want, radix: 16))"
      case let .badVersion(got, want): "format version \(got), expected \(want)"
      case .checksum: "checksum mismatch: the fixture is corrupt or truncated"
      }
    }
  }

  public let data: Data
  public private(set) var offset = 0

  public init(_ data: Data) { self.data = data }

  private mutating func take(_ n: Int) throws -> Int {
    guard offset + n <= data.count else { throw Err.truncated(needed: n, at: offset, of: data.count) }
    defer { offset += n }
    return offset
  }

  public mutating func u8() throws -> UInt8 { data[data.startIndex + (try take(1))] }
  public mutating func u16() throws -> UInt16 { try load(UInt16.self) }
  public mutating func u32() throws -> UInt32 { try load(UInt32.self) }
  public mutating func u64() throws -> UInt64 { try load(UInt64.self) }
  public mutating func i32() throws -> Int32 { try load(Int32.self) }
  public mutating func f32() throws -> Float { try load(Float.self) }
  public mutating func f64() throws -> Double { try load(Double.self) }

  private mutating func load<T>(_ type: T.Type) throws -> T {
    let at = try take(MemoryLayout<T>.size)
    return data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: T.self) }
  }

  public mutating func string(_ n: Int) throws -> String {
    let at = try take(n)
    return String(decoding: data[(data.startIndex + at)..<(data.startIndex + at + n)], as: UTF8.self)
  }

  public mutating func i32s(_ n: Int) throws -> [Int32] {
    var out = [Int32](); out.reserveCapacity(n)
    for _ in 0..<n { out.append(try i32()) }
    return out
  }

  public mutating func f32s(_ n: Int) throws -> [Float] {
    var out = [Float](); out.reserveCapacity(n)
    for _ in 0..<n { out.append(try f32()) }
    return out
  }

  public mutating func bytes(_ n: Int) throws -> Data {
    let at = try take(n)
    return data[(data.startIndex + at)..<(data.startIndex + at + n)]
  }

  /// FNV-1a over a range already read, for verifying a fixture's trailer.
  public func fnv1a64(from: Int, to: Int) -> UInt64 {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    let prime: UInt64 = 0x0000_0100_0000_01b3
    data.withUnsafeBytes { raw in
      for i in from..<to { h = (h ^ UInt64(raw[i])) &* prime }
    }
    return h
  }
}
