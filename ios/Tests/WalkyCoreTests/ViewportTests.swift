import Testing
import Foundation
@testable import WalkyCore

/// Ported from `web/src/__tests__/viewport.test.ts`, case for case.
///
/// A ported test that passes is evidence of behavioural parity, which is the
/// same currency the golden fixtures trade in. These are not new assertions
/// invented for the Swift side.

private func view() -> Viewport {
  var v = Viewport()
  v.width = 400
  v.height = 300
  return v
}

private func isClose(_ a: Double, _ b: Double, _ places: Int) -> Bool {
  abs(a - b) < jsPow(10, -Double(places)) / 2
}

@Suite("Viewport.zoomByRatio")
struct ZoomByRatioTests {
  @Test("scales by the ratio the fingers measured")
  func scales() {
    var v = view()
    v.zoomByRatio(Point(200, 150), 2)
    #expect(isClose(v.scale, 2, 10))
    v.zoomByRatio(Point(200, 150), 0.5)
    #expect(isClose(v.scale, 1, 10))
  }

  @Test("leaves the world point under the pinch where it was")
  func anchored() {
    var v = view()
    v.targetX = 37
    v.targetY = -19
    let anchor = Point(310, 80)
    let before = v.screenToWorld(anchor)
    v.zoomByRatio(anchor, 3.7)
    let after = v.screenToWorld(anchor)
    #expect(isClose(after.x, before.x, 8))
    #expect(isClose(after.y, before.y, 8))
  }

  @Test("lands between the notches a wheel is limited to")
  func betweenNotches() {
    var v = view()
    v.zoomByRatio(Point(200, 150), 1.4)
    #expect(v.zoomLevel != v.zoomLevel.rounded())
    // Still the same level -> scale relationship the wheel uses.
    #expect(isClose(v.scale, jsPow(ZOOM_FACTOR, -v.zoomLevel), 10))
  }

  @Test("clamps to the same limits the wheel has")
  func clamps() {
    var zoomedIn = view()
    zoomedIn.zoomByRatio(Point(200, 150), 1e9)
    #expect(zoomedIn.zoomLevel == ZOOM_LEVEL_MIN)

    var zoomedOut = view()
    zoomedOut.zoomByRatio(Point(200, 150), 1e-9)
    #expect(zoomedOut.zoomLevel == ZOOM_LEVEL_MAX)
  }

  @Test("ignores a ratio a degenerate pinch would produce")
  func degenerate() {
    var v = view()
    v.zoomByRatio(Point(200, 150), 2)
    let level = v.zoomLevel
    for bad in [0, -1, Double.nan, Double.infinity] {
      v.zoomByRatio(Point(200, 150), bad)
      #expect(v.zoomLevel == level)
    }
  }

  @Test("agrees with the wheel when handed a whole notch")
  func agreesWithWheel() {
    var wheel = view()
    wheel.zoomAt(Point(310, 80), -3)

    var fingers = view()
    fingers.zoomByRatio(Point(310, 80), jsPow(ZOOM_FACTOR, 3))

    #expect(isClose(fingers.zoomLevel, wheel.zoomLevel, 10))
    #expect(isClose(fingers.targetX, wheel.targetX, 8))
    #expect(isClose(fingers.targetY, wheel.targetY, 8))
  }
}

@Suite("Viewport.reset")
struct ViewportResetTests {
  @Test("brings the drawing back after panning away from it")
  func recentres() {
    var v = view()
    let bounds = Bounds(minX: -50, minY: -40, maxX: 50, maxY: 40)
    v.zoomAt(Point(200, 150), 6)
    v.panBy(-4000, -3000)
    #expect(v.worldToScreen(Point(0, 0)).x < 0)   // the map is off screen

    v.reset(bounds)

    #expect(v.zoomLevel == 0)
    #expect(v.targetX == 0)
    #expect(v.targetY == 0)
    let centre = v.worldToScreen(Point(0, 0))
    #expect(isClose(centre.x, v.width / 2, 8))
    #expect(isClose(centre.y, v.height / 2, 8))
  }

  @Test("centres on the drawing wherever it was made")
  func centres() {
    var v = view()
    v.reset(Bounds(minX: 900, minY: 400, maxX: 1000, maxY: 500))
    #expect(v.zoomLevel == 0)
    #expect(v.targetX == 950)
    #expect(v.targetY == 450)
    let corner = v.worldToScreen(Point(900, 400))
    #expect(corner.x > 0)
    #expect(corner.y > 0)
  }

  @Test("zooms out far enough for a map too big for the starting zoom")
  func zoomsOut() {
    var v = view()
    v.reset(Bounds(minX: -600, minY: -450, maxX: 600, maxY: 450))
    #expect(v.zoomLevel > 0)
    for corner in [Point(-600, -450), Point(600, 450)] {
      let s = v.worldToScreen(corner)
      #expect(s.x >= 0 && s.x <= v.width)
      #expect(s.y >= 0 && s.y <= v.height)
    }
  }

  @Test("goes to the origin at the starting zoom with nothing drawn")
  func nothingDrawn() {
    var v = view()
    v.zoomAt(Point(200, 150), -4)
    v.panBy(500, 500)
    v.reset(nil)
    #expect(v.zoomLevel == 0)
    #expect(v.targetX == 0)
    #expect(v.targetY == 0)
  }
}

/// Ported from `web/src/__tests__/palette.test.ts`.
@Suite("Palette")
struct PaletteTests {
  @Test("matches Java Color.darker() truncation on the brief's real examples")
  func darkerTruncation() {
    #expect(javaDarker((196, 25, 192)) == (137, 17, 134))
    #expect(javaDarker((18, 253, 222)) == (12, 177, 155))
  }

  @Test("produces the documented shadow colours when applied twice")
  func shadows() {
    #expect(toHex(shadowOf((0xc4, 0x19, 0xc0))) == "#5F0B5D")
    #expect(toHex(shadowOf((0x12, 0xfd, 0xde))) == "#087B6C")
  }

  @Test("never goes below zero and is idempotent at zero")
  func floorAtZero() {
    #expect(javaDarker((0, 0, 0)) == (0, 0, 0))
    #expect(javaDarker((1, 2, 3)) == (0, 1, 2))
  }

  @Test("the background is DARK_GRAY darkened twice, i.e. #1E1E1E and not #1F1F1F")
  func background() {
    #expect(BACKGROUND == (30, 30, 30))
    #expect(toHex(BACKGROUND) == "#1E1E1E")
  }

  @Test("always leaves at least one channel at 150 or above, and stays in 0-255")
  func alwaysBright() {
    for _ in 0..<500 {
      let c = randomBrightColor()
      #expect(Swift.max(c.r, c.g, c.b) >= 150)
      for v in [c.r, c.g, c.b] { #expect(v >= 0 && v <= 255) }
    }
  }

  @Test("the accent is unreadable as text and its shadow is not")
  func accentContrast() {
    // Measured, not asserted from prose: the README rounds the first of these
    // to "1.4:1", but palette.ts computes 1.5540. The point it is making --
    // that the accent fails as text and shadowOf rescues it -- is what these
    // pin, at the values the code actually produces.
    #expect(shadowOf(ORANGE) == (124, 98, 0))
    #expect(isClose(contrastRatio(ORANGE, WHITE), 1.5539773338839267, 10))
    #expect(isClose(contrastRatio(shadowOf(ORANGE), WHITE), 5.826713233613355, 10))
    #expect(contrastRatio(shadowOf(ORANGE), WHITE) > 4.5)   // WCAG AA for body text
  }
}


/// The ceiling is per-map because an imported neighbourhood is not the world
/// the original's stops were chosen for. See `Viewport.zoomLevelMax`.
@Suite("Viewport.zoomLevelMax")
struct ZoomCeilingTests {
  @Test("defaults to the original's stop, so a drawn map is unchanged")
  func defaultsToTheOriginal() {
    #expect(Viewport().zoomLevelMax == ZOOM_LEVEL_MAX)
  }

  @Test("a raised ceiling is what a pinch is clamped to")
  func pinchClampsToTheCeiling() {
    var v = view()
    v.zoomLevelMax = 40
    v.zoomAt(Point(200, 150), 500)
    #expect(v.zoomLevel == 40)
  }

  @Test("fit shows a whole imported neighbourhood, which the old stop could not")
  func fitsAnImport() {
    // 260m at 56px to the metre, on a 402pt-wide phone.
    let across = 260.0 * 56
    let bounds = Bounds(minX: 0, minY: 0, maxX: across, maxY: across)

    var stuck = Viewport()
    stuck.width = 402; stuck.height = 874
    stuck.fit(bounds)
    #expect(stuck.zoomLevel == ZOOM_LEVEL_MAX)          // clamped, and far too close
    #expect(across * stuck.scale > 402 * 4)             // shows a quarter of it at best

    var roomy = stuck
    roomy.zoomLevelMax = 60
    roomy.fit(bounds)
    #expect(roomy.zoomLevel > ZOOM_LEVEL_MAX)
    #expect(across * roomy.scale <= 402)                // the whole import is on screen
  }

  @Test("reset never zooms in on a drawn map")
  func resetKeepsTheOpeningStop() {
    // The floor: a small drawn map opens where it was authored, and pressing
    // reset-zoom on one wall must not fill the screen with it.
    var v = Viewport()
    v.width = 402; v.height = 874
    let small = Bounds(minX: 0, minY: 0, maxX: 200, maxY: 200)
    v.fit(small)
    #expect(v.zoomLevel < 0)                            // fit alone would zoom in
    v.reset(small)
    #expect(v.zoomLevel == 0)
    #expect(v.homeLevel == 0)
  }

  @Test("an import that is smaller than the screen resets to its own framing")
  func homeLevelHoldsAnImportsFraming() {
    // A scanned room: 4m at 56px to the metre is 224 units, which fits two
    // notches in on a phone. Without `homeLevel` the reset would put it back in
    // a box in the middle of the display.
    var v = Viewport()
    v.width = 402; v.height = 874
    let room = Bounds(minX: 0, minY: 0, maxX: 4 * 56, maxY: 5 * 56)
    v.fit(room)
    v.homeLevel = v.zoomLevel
    let framed = v.zoomLevel
    #expect(framed < 0)

    v.zoomAt(Point(200, 150), 6)                        // wander out
    v.reset(room)
    #expect(v.zoomLevel == framed)
  }
}
