import CWalkyMath
import Foundation

/// JavaScript's arithmetic, where Swift's differs.
///
/// Every function here exists because a Swift spelling that looks equivalent is
/// not. The model's determinism is exact rather than approximate -- every
/// fidget, trait and tie-break is a positional hash, so two runs either land
/// every pedestrian on the same pixel or they part company and keep parting.
/// A last-bit disagreement is therefore a different run, not a small error.
///
/// The web app is deliberately untouched: the port is the newcomer, so the port
/// carries the whole compatibility burden.
@inline(__always) public func jsExp(_ x: Double) -> Double { walky_exp(x) }
@inline(__always) public func jsLog(_ x: Double) -> Double { walky_log(x) }
@inline(__always) public func jsSin(_ x: Double) -> Double { walky_sin(x) }
@inline(__always) public func jsCos(_ x: Double) -> Double { walky_cos(x) }
@inline(__always) public func jsAtan2(_ y: Double, _ x: Double) -> Double { walky_atan2(y, x) }
@inline(__always) public func jsAcos(_ x: Double) -> Double { walky_acos(x) }
/// `Math.pow` is the one exception: V8 does *not* use fdlibm for it.
///
/// Measured over the model's range (base 0.65, exponent a step length),
/// Darwin's `pow` agrees with V8 on every one of 20,000 samples, while the
/// fdlibm routine differs on 10.7% of them -- by exactly one ULP each time.
/// So this calls the platform, and `walky_pow` stays in CWalkyMath unused as
/// the evidence for why it is not called. The probe is what settled this; do
/// not "fix" it back to fdlibm without rerunning `walky-conform math`.
@inline(__always) public func jsPow(_ x: Double, _ y: Double) -> Double { Foundation.pow(x, y) }

/// `Math.hypot`, which is *not* `sqrt(dx*dx + dy*dy)`.
///
/// ECMAScript leaves hypot implementation-approximated. V8 computes
/// `max * sqrt(1 + (min/max)^2)`, and the naive form differs from it on 39% of
/// inputs -- measured over 300,000 random pairs in the model's coordinate range.
/// Every operation below is IEEE-754 correctly-rounded and mandated in both
/// languages, so this matches V8 by construction rather than by luck.
///
/// There are 20 call sites in `src/`, two of them per neighbour in the hottest
/// loop in the app (behaviour.ts:755, :773).
@inline(__always) public func jsHypot(_ a: Double, _ b: Double) -> Double {
  let x = abs(a), y = abs(b)
  if x.isInfinite || y.isInfinite { return .infinity }
  let hi = x > y ? x : y
  let lo = x > y ? y : x
  if hi == 0 { return 0 }
  let r = lo / hi
  return hi * (1 + r * r).squareRoot()
}

/// `Math.round`: half *up*, toward +infinity.
///
/// Swift's `.rounded()` is half-away-from-zero, so `Math.round(-1.5)` is `-1`
/// where `(-1.5).rounded()` is `-2`. This sits inside the hash input at
/// agents.ts:718 and behaviour.ts:503, and maps routinely use negative
/// coordinates -- determinism.test.ts places a block at (-560, -209) -- so
/// getting it wrong is silent and systematic over half of every map.
///
/// `floor(x + 0.5)` is not equivalent either: the spec gives
/// `Math.round(0.49999999999999994) === 0`, where `floor(x + 0.5)` gives 1.
@inline(__always) public func jsRound(_ x: Double) -> Double {
  guard x.isFinite else { return x }
  let f = x.rounded(.down)
  return (x - f >= 0.5) ? f + 1 : f
}

/// ECMAScript `ToInt32` on a Double: truncate toward zero, then modulo 2^32.
///
/// `Math.imul` applies this to its arguments, and two call sites hand it
/// doubles rather than integers -- `stuckWobble` (behaviour.ts:503) and the
/// per-spoke fidget (behaviour.ts:996). `Int32(truncatingIfNeeded:)` only
/// accepts integers, so it cannot stand in here.
@inline(__always) public func toInt32(_ d: Double) -> Int32 {
  guard d.isFinite, d != 0 else { return 0 }
  let t = d.rounded(.towardZero)
  let m = t.truncatingRemainder(dividingBy: 4294967296)
  let u = m < 0 ? m + 4294967296 : m
  return Int32(bitPattern: UInt32(u))
}

/// `Math.imul`: an Int32 wrapping multiply.
@inline(__always) public func imul(_ a: Int32, _ b: Int32) -> Int32 { a &* b }

/// `Math.imul` where the arguments arrive as doubles.
///
/// Deliberately not an overload of `imul`. An integer literal is convertible to
/// both, so an overloaded call like `imul(h, 73856093)` would be ambiguous at
/// best and silently pick the wrong semantics at worst -- and the two disagree
/// whenever an argument is fractional or outside Int32. Two call sites need
/// this form: `stuckWobble` (behaviour.ts:503) and the per-spoke fidget
/// (behaviour.ts:996), both of which hand `Math.imul` a double.
@inline(__always) public func imulD(_ a: Double, _ b: Double) -> Int32 { toInt32(a) &* toInt32(b) }

/// `>>>`: a logical shift on the uint32 reinterpretation.
@inline(__always) public func ushr(_ h: Int32, _ n: UInt32) -> Int32 {
  Int32(bitPattern: UInt32(bitPattern: h) >> n)
}

/// `h >>> 0`: reinterpretation, which is how the hashes reach [0, 2^32).
@inline(__always) public func toUint32(_ h: Int32) -> UInt32 { UInt32(bitPattern: h) }

/// `Math.min`/`Math.max`, which propagate NaN where `Swift.min`/`max` swallow it.
///
/// The model should never produce a NaN -- crowd.test.ts asserts everything
/// stays finite. These exist so that if one ever appears, both engines blow up
/// in the same place instead of quietly parting company.
@inline(__always) public func jsMin(_ a: Double, _ b: Double) -> Double {
  if a.isNaN || b.isNaN { return .nan }
  return a < b ? a : b
}
@inline(__always) public func jsMax(_ a: Double, _ b: Double) -> Double {
  if a.isNaN || b.isNaN { return .nan }
  return a > b ? a : b
}
