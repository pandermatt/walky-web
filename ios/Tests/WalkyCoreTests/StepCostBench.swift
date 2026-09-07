import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// What one tick costs, with nothing drawn.
///
/// Off by default -- it is a measurement, not an assertion, and a suite that
/// takes a second longer on every run to print numbers nobody read is a suite
/// people stop running:
///
///     WALKY_BENCH=1 swift test -c release --filter StepCostBench
///
/// **Run it in release or the number is meaningless.** Measured on this machine,
/// debug is about seventeen times slower: 4,000 agents cost 187 ms/tick built
/// debug and 10.8 ms/tick built release. That gap is larger than any rendering
/// change could be, and it is the first thing to rule out when the app feels
/// slow -- an in-app FPS readout from a debug build is measuring the build, not
/// the code.
@MainActor
@Suite("Step cost", .enabled(if: ProcessInfo.processInfo.environment["WALKY_BENCH"] != nil))
struct StepCostBench {
  @Test("one tick, by crowd size")
  func stepCost() {
    print("  agents   ms/tick   sustainable")
    for count in [500, 1000, 2000, 4000] {
      let world = WalkyWorld()
      world.settings.defaults = nil
      // A goal, so the crowd actually walks. A standing crowd costs a fraction
      // of this and would flatter the number into uselessness.
      world.addWallShape([rectanglePolygon(Point(-40, 600), Point(400, 660))], nil)
      let side = Int(Double(count).squareRoot()) + 1
      for i in 0..<count {
        let x = Double((i % side) * 18) - 300
        let y = Double((i / side) * 18) - 200
        _ = world.agents.add(Point(x, y), (255, 200, 0))
      }
      _ = world.setGoalAt(Point(180, 630))
      world.play(true)

      // Warm the navigation graph first: the first tick after a goal is marked
      // pays for a Dijkstra the rest do not.
      for _ in 0..<10 { world.stepOnce() }
      let started = Date()
      let ticks = 60
      for _ in 0..<ticks { world.stepOnce() }
      let ms = Date().timeIntervalSince(started) * 1000 / Double(ticks)
      print(String(format: "  %6d   %7.2f   %5.0f ticks/s", count, ms, 1000 / ms))
    }
  }
}
