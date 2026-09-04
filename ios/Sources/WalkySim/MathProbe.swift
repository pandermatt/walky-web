import Foundation

/// Reads `Fixtures/math.wkmp` and checks this port against V8, bit for bit.
///
/// The probe stores results only; the inputs are a hash of the sample index, so
/// they are regenerated here rather than read. That means the input generator
/// exists twice, which is normally exactly the trap to avoid -- it is safe here
/// only because a generator that disagreed would mismatch on essentially every
/// sample rather than a few, and so cannot be confused with a rounding
/// difference. `guards` makes it say so outright.
public struct MathProbe {
  public struct Function {
    public let name: String
    public let arity: Int
    public let count: Int
    /// The first four (a, b) pairs as the generator produced them.
    public let guards: [(Double, Double)]
    public let expected: [Double]
  }

  public struct Result {
    public let name: String
    public let samples: Int
    public let mismatches: Int
    /// First disagreement: input, ours, V8's.
    public let firstBad: (a: Double, b: Double, got: Double, want: Double)?
    public let guardFailed: Bool
  }

  public let functions: [Function]

  public init(contentsOf url: URL) throws {
    let data = try Data(contentsOf: url)
    var o = 0
    func u32() -> UInt32 {
      defer { o += 4 }
      return data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: o, as: UInt32.self) }
    }
    func u8() -> UInt8 { defer { o += 1 }; return data[data.startIndex + o] }
    func f64() -> Double {
      defer { o += 8 }
      return data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: o, as: Double.self) }
    }

    guard u32() == 0x504d4b57 else { throw Err.badMagic }   // "WKMP"
    guard u32() == 1 else { throw Err.badVersion }
    let n = Int(u32())

    var fns: [Function] = []
    for _ in 0..<n {
      let len = Int(u8())
      let name = String(decoding: data[(data.startIndex + o)..<(data.startIndex + o + len)], as: UTF8.self)
      o += len
      let arity = Int(u8())
      let count = Int(u32())
      var guards: [(Double, Double)] = []
      for _ in 0..<4 { guards.append((f64(), f64())) }
      var expected = [Double](repeating: 0, count: count)
      for i in 0..<count { expected[i] = f64() }
      fns.append(Function(name: name, arity: arity, count: count, guards: guards, expected: expected))
    }
    self.functions = fns
  }

  enum Err: Error { case badMagic, badVersion }

  // The generator's hash and ranges, mirrored from tools/mathProbe.ts.
  static func rnd(_ i: Int, _ salt: Int32) -> Double {
    var h = salt ^ imul(Int32(truncatingIfNeeded: i), 73856093)
    h = imul(h ^ ushr(h, 15), Int32(bitPattern: 2246822519))
    h = imul(h ^ ushr(h, 13), Int32(bitPattern: 3266489917))
    h ^= ushr(h, 16)
    return Double(toUint32(h)) / 4294967296
  }
  static func lerp(_ u: Double, _ lo: Double, _ hi: Double) -> Double { lo + u * (hi - lo) }

  static func sample(_ name: String, _ i: Int) -> (Double, Double) {
    switch name {
    case "exp":       return (lerp(rnd(i, 0x9e37), -30, 2), 0)
    case "log":       return (lerp(rnd(i, 0x85eb), 1e-12, 1), 0)
    case "sin":       return (lerp(rnd(i, Int32(bitPattern: 0xc2b2)), -201_400, 201_400), 0)
    case "cos":       return (lerp(rnd(i, 0x27d4), -201_400, 201_400), 0)
    case "sin-small": return (lerp(rnd(i, 0x165667), -4, 4), 0)
    case "cos-small": return (lerp(rnd(i, Int32(bitPattern: 0xd3a2)), -4, 4), 0)
    case "atan2":     return (lerp(rnd(i, 0x1b87), -1, 1), lerp(rnd(i, 0x6a09), -1, 1))
    case "acos":      return (lerp(rnd(i, Int32(bitPattern: 0xbb67)), -1, 1), 0)
    case "pow":       return (0.65, lerp(rnd(i, 0x3c6e), 0, 1.5))
    case "hypot":     return (lerp(rnd(i, Int32(bitPattern: 0xa54f)), -4000, 4000),
                              lerp(rnd(i, 0x510e), -4000, 4000))
    default:          return (.nan, .nan)
    }
  }

  static func apply(_ name: String, _ a: Double, _ b: Double) -> Double {
    switch name {
    case "exp":                   return jsExp(a)
    case "log":                   return jsLog(a)
    case "sin", "sin-small":      return jsSin(a)
    case "cos", "cos-small":      return jsCos(a)
    case "atan2":                 return jsAtan2(a, b)
    case "acos":                  return jsAcos(a)
    case "pow":                   return jsPow(a, b)
    case "hypot":                 return jsHypot(a, b)
    default:                      return .nan
    }
  }

  public func run() -> [Result] {
    functions.map { fn in
      // Bit patterns, not values: two NaNs compare unequal and -0 == 0, and
      // both of those distinctions matter to a model that hashes positions.
      var guardFailed = false
      for (i, g) in fn.guards.enumerated() {
        let (a, b) = Self.sample(fn.name, i)
        if a.bitPattern != g.0.bitPattern || b.bitPattern != g.1.bitPattern { guardFailed = true }
      }
      var bad = 0
      var first: (Double, Double, Double, Double)?
      for i in 0..<fn.count {
        let (a, b) = Self.sample(fn.name, i)
        let got = Self.apply(fn.name, a, b)
        let want = fn.expected[i]
        if got.bitPattern != want.bitPattern {
          bad += 1
          if first == nil { first = (a, b, got, want) }
        }
      }
      return Result(name: fn.name, samples: fn.count, mismatches: bad,
                    firstBad: first.map { (a: $0.0, b: $0.1, got: $0.2, want: $0.3) },
                    guardFailed: guardFailed)
    }
  }
}
