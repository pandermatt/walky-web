import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// The warning when a crowd gets big enough to cost real time.
///
/// Worth pinning because the failure mode is not "no warning" but "a warning
/// per brush point" -- `addPedestrians` runs on every point of a drag, dozens a
/// second, and each one would push a notice.
@MainActor
@Suite("Crowd warning")
struct CrowdWarningTests {
  /// Collects notices. A class, not a captured `var`: an escaping closure boxes
  /// a local, so returning the array hands back a snapshot and later notices
  /// land somewhere the caller cannot see. That cost one confusing red test.
  private final class Heard {
    var lines: [String] = []
  }

  private func fresh(_ brush: Double = 5) -> (WalkyWorld, Heard) {
    let world = WalkyWorld()
    world.settings.defaults = nil
    world.settings.brushSize = brush
    let heard = Heard()
    world.onNotify = { heard.lines.append($0) }
    return (world, heard)
  }

  /// Paints in blocks until the crowd passes `target`.
  private func paint(_ world: WalkyWorld, to target: Int) {
    var x = 0.0
    while world.agents.count < target && x < 60_000 {
      world.addPedestrians(Point(x, 0))
      x += 400
    }
  }

  @Test("says so once, not once per brush point")
  func firesOnce() {
    let (world, heard) = fresh()
    paint(world, to: CROWD_WARN_AT + 200)
    #expect(world.agents.count >= CROWD_WARN_AT)
    #expect(heard.lines.count == 1)
    #expect(heard.lines.first?.contains("slow down") == true)
  }

  @Test("a crowd under the threshold is not mentioned at all")
  func quietBelow() {
    let (world, heard) = fresh()
    paint(world, to: CROWD_WARN_AT / 4)
    #expect(world.agents.count < CROWD_WARN_AT)
    #expect(heard.lines.isEmpty)
  }

  /// Re-arms when the crowd goes away, so clearing the map and painting another
  /// one warns again rather than staying silent for the rest of the session.
  @Test("clearing the map re-arms it")
  func reArms() {
    let (world, heard) = fresh()
    paint(world, to: CROWD_WARN_AT + 200)
    #expect(heard.lines.count == 1)

    world.clearAll()
    #expect(world.agents.count == 0)

    paint(world, to: CROWD_WARN_AT + 200)
    #expect(heard.lines.count == 2)
  }
}
