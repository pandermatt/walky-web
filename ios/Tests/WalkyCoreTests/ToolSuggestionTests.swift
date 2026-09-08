import Foundation
import Testing

@testable import WalkyCore
@testable import WalkySim

/// The nudge when somebody drags around a map with nothing on it.
///
/// The policy lives on the world rather than in `PointerRouter`, because the
/// router knows the gesture happened and only the world knows whether the map
/// is empty. These pin the two halves of that policy: *empty only*, and *once*.
@MainActor
@Suite("Pick a tool")
struct ToolSuggestionTests {
  private final class Heard {
    var lines: [String] = []
  }

  private func fresh() -> (WalkyWorld, Heard) {
    let world = WalkyWorld()
    world.settings.defaults = nil
    let heard = Heard()
    world.onNotify = { heard.lines.append($0) }
    return (world, heard)
  }

  /// `PointerRouter.moved` fires dozens of times in one drag, so "once" is the
  /// whole feature -- without the guard a single pan is a drumbeat of notices.
  @Test("a blank map says it once, however long the drag")
  func oncePerSession() {
    let (world, heard) = fresh()
    #expect(world.isEmpty)

    for _ in 0..<40 { world.pannedWithoutTool() }

    #expect(heard.lines.count == 1)
    #expect(heard.lines.first?.contains("pick a tool") == true)
  }

  /// Panning across a map you have already drawn is ordinary navigation.
  @Test("a map with something on it is left alone")
  func quietOnceDrawn() {
    let (world, heard) = fresh()
    world.addWallShape([rectanglePolygon(Point(0, 0), Point(100, 100))], nil)
    #expect(world.isEmpty == false)

    for _ in 0..<40 { world.pannedWithoutTool() }

    #expect(heard.lines.isEmpty)
  }

  /// Pedestrians count as content too -- `isEmpty` is walls *and* crowd.
  @Test("a crowd with no walls also counts as drawn")
  func crowdCountsAsContent() {
    let (world, heard) = fresh()
    world.addPedestrians(Point(0, 0))
    #expect(world.agents.count > 0)
    #expect(world.isEmpty == false)

    world.pannedWithoutTool()
    #expect(heard.lines.isEmpty)
  }
}
