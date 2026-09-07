import Testing
@testable import WalkySim

/// `arrivals`, `clock` and `metrics` are the three files in `sim/` that no
/// golden trace reaches: no scenario has a generator, and neither the clock nor
/// the metrics can move anybody. So "bit-identical to V8" says nothing about
/// them, and these say it instead.
///
/// Every expected value below came out of node, not out of a head.

@Suite("Arrivals")
struct ArrivalsTests {
  @Test("a door's schedule matches V8, door for door and beat for beat")
  func schedules() {
    // node: burstAt([x, y], beat, rate) -> "size/gap"
    let cases: [(Point, Double, [(Double, Double)])] = [
      (Point(100, 200), 1,  [(3, 159), (2, 183), (4, 38), (1, 102)]),
      (Point(100, 200), 4,  [(11, 146), (4, 92), (15, 35), (4, 102)]),
      (Point(100, 200), 20, [(11, 29), (4, 18), (15, 7), (4, 20)]),
      (Point(-340, 55), 1,  [(1, 139), (1, 10), (3, 376), (1, 49)]),
      (Point(-340, 55), 4,  [(2, 69), (2, 5), (9, 282), (2, 24)]),
      (Point(0, 0), 4,      [(2, 69), (4, 139), (16, 160), (5, 81)]),
      (Point(1234, -987), 4, [(1, 35), (4, 63), (3, 17), (4, 48)]),
    ]
    for (at, rate, want) in cases {
      for beat in 0..<want.count {
        let b = burstAt(at, Double(beat), rate)
        #expect(b.size == want[beat].0, "size at \(at) rate \(rate) beat \(beat)")
        #expect(b.gap == want[beat].1, "gap at \(at) rate \(rate) beat \(beat)")
      }
    }
  }

  @Test("a door at the origin is not a special case")
  func originDoor() {
    // Worth stating: `doorOf` hashes the position, and (0,0) is where a
    // half-hearted hash would collapse.
    #expect(burstAt(Point(0, 0), 0, 4).size == 2)
    #expect(burstAt(Point(0, 0), 2, 4).size == 16)   // the MAX_BURST cap
  }

  @Test("the queue ceiling is three clumps' worth")
  func queueMax() { #expect(QUEUE_MAX == 12) }
}

@Suite("Clock")
struct ClockTests {
  @Test("banks wall-clock time and pays it out in whole ticks")
  func advance() {
    // node: new Clock(), then advance() at these millisecond stamps.
    let c = Clock()
    #expect(c.advance(0) == 1)       // the first call always buys exactly one
    #expect(c.advance(16.7) == 1)
    #expect(c.advance(33.4) == 1)
    #expect(c.advance(50) == 0)      // the accumulator is short of a whole step
    #expect(c.advance(1000) == 3)    // capped at MAX_SUBSTEPS, remainder forgiven
    #expect(c.advance(1016) == 0)
  }

  @Test("a reset starts a fresh account rather than a burst of catch-up")
  func reset() {
    let c = Clock()
    _ = c.advance(0)
    _ = c.advance(5000)
    c.reset()
    #expect(c.advance(9999) == 1)
  }

  @Test("time running backwards buys nothing")
  func backwards() {
    // `Math.max(0, now - last)`: a clock that jumped back would otherwise
    // bank a negative and stall.
    let c = Clock()
    _ = c.advance(1000)
    #expect(c.advance(500) == 0)
  }
}
