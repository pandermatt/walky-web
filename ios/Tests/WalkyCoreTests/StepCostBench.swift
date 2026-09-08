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
///
/// Two maps on purpose. `open` is one wall, which is also the goal: the crowd
/// can see it from anywhere, so `Navigation.nextWaypoint` takes its cheap
/// direct-visibility branch and the visibility graph stays at a handful of
/// nodes. That isolates the crowd cost -- and it is *not* what a hand-drawn map
/// looks like. `maze` puts obstacles between the crowd and the goal, so
/// pedestrians have to route around them: `nextWaypoint` falls to its
/// all-nodes scan, and every `isVisible` is a segment test against every wall
/// group. The TypeScript bench made this choice deliberately
/// (`web/bench/simulation.ts:31-33`); the Swift one did not, which is why its
/// numbers looked flattering.
@MainActor
@Suite("Step cost", .enabled(if: ProcessInfo.processInfo.environment["WALKY_BENCH"] != nil))
struct StepCostBench {
  /// The goal bar every scenario walks to.
  private static func addGoal(_ world: WalkyWorld) {
    world.addWallShape([rectanglePolygon(Point(-40, 600), Point(400, 660))], nil)
  }

  /// Obstacles between the crowd and the goal, in two staggered rows with gaps,
  /// so the route is genuinely around something rather than through it.
  private static func addMaze(_ world: WalkyWorld) {
    for row in 0..<2 {
      let y = 120.0 + Double(row) * 180
      for col in 0..<6 {
        let x = -360.0 + Double(col) * 130 + (row == 1 ? 65 : 0)
        world.addWallShape([rectanglePolygon(Point(x, y), Point(x + 80, y + 60))], nil)
      }
    }
  }

  private static func crowd(_ world: WalkyWorld, _ count: Int) {
    let side = Int(Double(count).squareRoot()) + 1
    for i in 0..<count {
      let x = Double((i % side) * 18) - 300
      let y = Double((i / side) * 18) - 320
      _ = world.agents.add(Point(x, y), (255, 200, 0))
    }
  }

  /// Best of several runs, not the mean.
  ///
  /// One run of sixty ticks varies by about 20% here -- 4,000 agents measured
  /// 11.36, 13.70 and 12.84 ms on three consecutive runs of the same binary --
  /// which is far too loose to see the small wins this bench exists to guide.
  /// Timing noise is one-sided: the scheduler can only ever add time, so the
  /// fastest run is the closest to the code's own cost, while a mean mostly
  /// reports what else the machine was doing.
  private static func msPerTick(_ build: () -> WalkyWorld) -> Double {
    var best = Double.infinity
    for _ in 0..<5 {
      let world = build()
      // Warm the navigation graph first: the first tick after a goal is marked
      // pays for a Dijkstra the rest do not.
      for _ in 0..<10 { world.stepOnce() }
      let started = Date()
      let ticks = 60
      for _ in 0..<ticks { world.stepOnce() }
      best = min(best, Date().timeIntervalSince(started) * 1000 / Double(ticks))
    }
    return best
  }

  @Test("one tick, by crowd size and map")
  func stepCost() {
    print("  agents        open              maze          maze/open")
    for count in [500, 1000, 2000, 4000] {
      var results: [Double] = []
      for maze in [false, true] {
        results.append(Self.msPerTick {
          let world = WalkyWorld()
          world.settings.defaults = nil
          Self.addGoal(world)
          if maze { Self.addMaze(world) }
          Self.crowd(world, count)
          _ = world.setGoalAt(Point(180, 630))
          world.play(true)
          return world
        })
      }
      let open = results[0]
      let maze = results[1]
      print(String(format: "  %6d  %7.2f ms %5.0f/s  %7.2f ms %5.0f/s     %4.1fx",
                   count, open, 1000 / open, maze, 1000 / maze, maze / open))
    }
  }
}
