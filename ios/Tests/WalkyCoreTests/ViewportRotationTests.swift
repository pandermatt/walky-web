import Testing
import Foundation
@testable import WalkyCore

/// **Not a port.** The web viewport has no rotation, so unlike `ViewportTests`
/// there is nothing on the other side to agree with -- these assertions are
/// written here, about behaviour that exists only on iOS.
///
/// What they are mostly guarding is the pair `worldToScreen`/`screenToWorld`,
/// which every hit test in the app goes through. A rotation applied to one and
/// not the other is invisible until a finger lands in the wrong place.

private func view() -> Viewport {
  var v = Viewport()
  v.width = 400
  v.height = 300
  return v
}

private func isClose(_ a: Double, _ b: Double, _ places: Int) -> Bool {
  abs(a - b) < jsPow(10, -Double(places)) / 2
}

@Suite("A rotated viewport")
struct ViewportRotationTests {
  @Test("starts straight, and the transforms ignore it while it is")
  func defaultsToNorth() {
    var v = view()
    #expect(v.rotation == 0)
    v.targetX = 37
    v.targetY = -19
    v.zoomByRatio(Point(200, 150), 2)
    // The unrotated arithmetic, written out, so a regression in the rotated
    // path cannot quietly change what every ported test measures.
    let s = v.scale
    let p = v.worldToScreen(Point(90, 40))
    #expect(isClose(p.x, 200 + (90 - 37) * s, 8))
    #expect(isClose(p.y, 150 + (40 + 19) * s, 8))
  }

  @Test("world and screen stay inverses of each other at any angle")
  func roundTrips() {
    for degrees in [-179.0, -90, -31, 0, 17, 90, 135, 180] {
      var v = view()
      v.targetX = -140
      v.targetY = 62
      v.zoomByRatio(Point(200, 150), 1.7)
      v.rotateBy(Point(200, 150), degrees * Double.pi / 180)
      for probe in [Point(0, 0), Point(399, 0), Point(12, 288), Point(200, 150)] {
        let back = v.worldToScreen(v.screenToWorld(probe))
        #expect(isClose(back.x, probe.x, 6), "x at \(degrees)°")
        #expect(isClose(back.y, probe.y, 6), "y at \(degrees)°")
      }
    }
  }

  @Test("a quarter turn puts world +x down the screen")
  func quarterTurn() {
    var v = view()
    v.rotateBy(Point(200, 150), Double.pi / 2)
    let p = v.worldToScreen(Point(50, 0))
    #expect(isClose(p.x, 200, 6))
    #expect(isClose(p.y, 150 + 50, 6))
  }

  @Test("leaves the world point under the fingers where it was")
  func anchored() {
    var v = view()
    v.targetX = 37
    v.targetY = -19
    let pivot = Point(310, 80)
    let before = v.screenToWorld(pivot)
    v.rotateBy(pivot, 0.9)
    let after = v.screenToWorld(pivot)
    #expect(isClose(after.x, before.x, 8))
    #expect(isClose(after.y, before.y, 8))
  }

  @Test("a pan follows the finger rather than the world's axes")
  func panFollowsTheScreen() {
    var v = view()
    // A quarter turn: dragging right across the glass must still move the view
    // right across the glass. Before `panBy` undid the rotation it moved the
    // world's +x instead, so the map slid off at ninety degrees to the finger.
    v.rotateBy(Point(200, 150), Double.pi / 2)
    let centreWas = v.screenToWorld(Point(200, 150))
    v.panBy(60, 0)
    let moved = v.worldToScreen(centreWas)
    #expect(isClose(moved.x, 200 + 60, 6))
    #expect(isClose(moved.y, 150, 6))
  }

  @Test("winds round rather than up")
  func wraps() {
    var v = view()
    v.rotateBy(Point(200, 150), Double.pi * 1.5)
    #expect(v.rotation <= Double.pi && v.rotation > -Double.pi)
    #expect(isClose(v.rotation, -Double.pi / 2, 8))
  }

  @Test("snaps a nearly-straight map straight, and leaves a real tilt alone")
  func snapping() {
    var v = view()
    // Bound to a local first throughout: `#expect` cannot call a mutating
    // member on the value it is inspecting.
    v.rotateBy(Point(200, 150), NORTH_SNAP / 2)
    let snapped = v.snapNorth()
    #expect(snapped)
    #expect(v.rotation == 0)

    v.rotateBy(Point(200, 150), NORTH_SNAP * 3)
    let held = v.snapNorth()
    #expect(!held)
    #expect(v.rotation != 0)

    // Already straight is not a move, so the caller does not redraw for nothing.
    v.rotation = 0
    let idle = v.snapNorth()
    #expect(!idle)
  }

  @Test("reset and fit both come back to straight")
  func resetStraightens() {
    var v = view()
    v.rotateBy(Point(200, 150), 1.2)
    v.reset(nil)
    #expect(v.rotation == 0)

    v.rotateBy(Point(200, 150), 1.2)
    v.reset(Bounds(minX: 0, minY: 0, maxX: 900, maxY: 400))
    #expect(v.rotation == 0)
  }
}
