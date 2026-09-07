import Testing
@testable import WalkySim

/// Every expected value here was read out of node, not recalled -- these are
/// the exact cases where a Swift spelling that looks right is not.

@Suite("Math.round is half-up, not half-away-from-zero")
struct JSRoundTests {
  @Test("rounds negative halves toward zero's side, as JS does")
  func negativeHalves() {
    // Swift's .rounded() gives -1, -2, -3 for these. The model hashes rounded
    // coordinates (agents.ts:718) and maps routinely sit in negative space, so
    // the difference is not academic.
    #expect(jsRound(-0.5) == 0)
    #expect(jsRound(-1.5) == -1)
    #expect(jsRound(-2.5) == -2)
    #expect(jsRound(-209.5) == -209)   // determinism.test.ts places a block at y = -209
    #expect((-1.5).rounded() == -2)     // the trap, stated
  }

  @Test("positive halves round up, as both languages agree")
  func positiveHalves() {
    #expect(jsRound(0.5) == 1)
    #expect(jsRound(1.5) == 2)
    #expect(jsRound(2.5) == 3)
  }

  @Test("the largest double below 0.5 rounds to 0, where floor(x + 0.5) gives 1")
  func theSpecCase() {
    let x = 0.49999999999999994
    #expect(jsRound(x) == 0)
    #expect((x + 0.5).rounded(.down) == 1)   // why the obvious shortcut is wrong
  }

  @Test("non-finite input passes through")
  func nonFinite() {
    #expect(jsRound(.infinity) == .infinity)
    #expect(jsRound(.nan).isNaN)
  }
}

@Suite("ToInt32 and the integer hashes")
struct JSIntTests {
  @Test("ToInt32 truncates toward zero, then wraps modulo 2^32")
  func toInt32Semantics() {
    #expect(toInt32(3.7) == 3)
    #expect(toInt32(-3.7) == -3)
    #expect(toInt32(4294967296.5) == 0)
    #expect(toInt32(-4294967297.2) == -1)
    #expect(toInt32(1e21) == -559939584)     // node: Math.imul(1e21, 1)
    #expect(toInt32(.nan) == 0)
    #expect(toInt32(.infinity) == 0)
    #expect(toInt32(0) == 0)
  }

  @Test("imul wraps rather than trapping")
  func imulWraps() {
    #expect(imul(-560, 73856093) == 1_590_260_880)   // node: Math.imul(-560, 73856093)
    #expect(imul(73856093, 19349663) == 271_844_803)
    // The double form is a separate name on purpose: an overload would be
    // ambiguous against an integer literal, and the two disagree on fractions.
    #expect(imulD(3.7, 2.9) == 6)
    #expect(imul(3, 2) == 6)
  }

  @Test("ushr is a logical shift on the unsigned reinterpretation")
  func logicalShift() {
    #expect(ushr(-1, 16) == 65535)      // node: (-1 >>> 16)
    #expect(toUint32(-1) == 4294967295)
  }

  @Test("traitOf's mixer reproduces V8 exactly at a negative placement")
  func traitMixer() {
    // The whole chain at once: jsRound on negatives, imul wrapping, ushr, and
    // the final >>> 0. node gives 2338890851 / 0.5445654622744769 for this.
    var h = Int32(1) ^ imul(Int32(jsRound(-560)), 73856093) ^ imul(Int32(jsRound(-209)), 19349663)
    h = imul(h ^ ushr(h, 15), Int32(bitPattern: 2246822519))
    h = imul(h ^ ushr(h, 13), Int32(bitPattern: 3266489917))
    h ^= ushr(h, 16)
    #expect(toUint32(h) == 2338890851)
    #expect(Double(toUint32(h)) / 4294967296 == 0.5445654622744769)
  }
}

@Suite("Math.hypot is not sqrt(a*a + b*b)")
struct JSHypotTests {
  @Test("agrees with V8 on the exact cases")
  func exactCases() {
    #expect(jsHypot(3, 4) == 5)
    #expect(jsHypot(0, 0) == 0)
    #expect(jsHypot(-5, 0) == 5)
  }

  @Test("infinity wins over NaN, as the spec requires")
  func infinities() {
    #expect(jsHypot(.infinity, .nan) == .infinity)
    #expect(jsHypot(.nan, -.infinity) == .infinity)
  }

  @Test("differs from the naive form often enough to matter")
  func differsFromNaive() {
    // Over the model's coordinate range the two disagree on ~39% of inputs.
    // A handful is enough to prove the port did not quietly take the shortcut.
    var differing = 0
    for i in 0..<2000 {
      let a = Double(i) * 0.37 - 370, b = Double(i) * 0.91 - 910
      if jsHypot(a, b).bitPattern != (a * a + b * b).squareRoot().bitPattern { differing += 1 }
    }
    #expect(differing > 100)
  }
}

@Suite("min and max propagate NaN, as Math.min does")
struct JSMinMaxTests {
  @Test("NaN wins whichever side it arrives on")
  func nanPropagates() {
    #expect(jsMin(.nan, 1).isNaN)
    #expect(jsMin(1, .nan).isNaN)
    #expect(jsMax(.nan, 1).isNaN)
    #expect(jsMax(1, .nan).isNaN)
  }

  @Test("Swift's own min and max are order-dependent with NaN")
  func theTrapStated() {
    // Worse than simply swallowing it: `Swift.min` is `y < x ? y : x`, so a NaN
    // survives in first position and vanishes in second. A ported expression
    // would then depend on argument order in a way the JS original does not.
    #expect(Swift.min(Double.nan, 1).isNaN)
    #expect(Swift.min(1, Double.nan) == 1)
    #expect(Swift.max(Double.nan, 1).isNaN)
    #expect(Swift.max(1, Double.nan) == 1)
  }

  @Test("ordinary values behave")
  func ordinary() {
    #expect(jsMin(2, 3) == 2)
    #expect(jsMax(2, 3) == 3)
  }
}
