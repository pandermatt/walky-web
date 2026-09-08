import Testing
import Foundation
@testable import WalkyCore

/// The suite the whole `WalkyCore` split exists for.
///
/// `app.ts:457–720` is the most intricate code in the port and the least
/// forgiving: every rule in it is there because something felt wrong without
/// it. None of this could be tested if it lived in the app target, because
/// there is no simulator runtime to run the app target in.

/// A tool that records what it was told, in order.
@MainActor
private final class RecordingTool: Tool {
  let id = ToolId.wall
  enum Event: Equatable { case down(Point), move(Point), up(Point), doubleTap(Point), cancel }
  var events: [Event] = []

  func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext) { events.append(.down(e.world)) }
  func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) { events.append(.move(e.world)) }
  func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext) { events.append(.up(e.world)) }
  func onDoubleTap(_ e: PointerInfo, _ ctx: ToolContext) { events.append(.doubleTap(e.world)) }
  func cancel() { events.append(.cancel) }
  func preview() -> ToolPreview { .empty }
}

@MainActor
private final class FakeHost: PointerHost {
  var viewport = Viewport()
  var tool: Tool?
  var mouseWorld: Point?
  var renders = 0
  var freePans = 0
  let recorder = RecordingTool()

  init() {
    viewport.width = 400
    viewport.height = 300
    tool = recorder
  }

  func requestRender() { renders += 1 }
  func pannedWithoutTool() { freePans += 1 }

  lazy var toolContext: ToolContext = ToolContext(
    addWall: { _, _ in true }, addWallShape: { _, _ in true },
    settings: { SettingsSnapshot(pedestrianRadius: 13, personalSpace: 40,
                                 brushSize: 1, borderThickness: 12) },
    pedestrianBlock: { _, _ in [] }, addPedestrians: { _ in },
    setGoalAt: { _ in true }, clearSelection: {}, deactivateTool: {},
    notify: { _ in }, requestRender: { [unowned self] in self.renders += 1 },
    colorAt: { _ in nil }, worldPerPixel: { [unowned self] in self.viewport.worldPerPixel })
}

private let A = TouchId(1)
private let B = TouchId(2)
private let C = TouchId(3)

@Suite("PointerRouter")
@MainActor
struct PointerRouterTests {

  @Test("a press reaches the tool on the first move, not on the touch")
  func pressIsWithheld() {
    let host = FakeHost()
    let r = PointerRouter(host: host)

    r.began(A, at: Point(100, 100))
    // The whole point: nothing yet. A second finger could still take this back.
    #expect(host.recorder.events.isEmpty)
    #expect(r.hasPendingPress)

    r.moved(A, to: Point(120, 100))
    r.ended(A, at: Point(120, 100))

    // The down carries where the finger *landed*, not where it had moved to.
    let landed = host.viewport.screenToWorld(Point(100, 100))
    let moved = host.viewport.screenToWorld(Point(120, 100))
    #expect(host.recorder.events == [.down(landed), .move(moved), .up(moved)])
  }

  @Test("a press with no move at all still reaches the tool on lift")
  func pressFlushesOnLift() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(50, 60))
    r.ended(A, at: Point(50, 60))
    let p = host.viewport.screenToWorld(Point(50, 60))
    #expect(host.recorder.events == [.down(p), .up(p)])
  }

  @Test("a second finger retracts the withheld press and cancels the tool")
  func secondFingerRetracts() {
    let host = FakeHost()
    let r = PointerRouter(host: host)

    r.began(A, at: Point(100, 100))
    r.began(B, at: Point(200, 100))

    // The tool never heard the press, and was told to abandon anything begun.
    #expect(host.recorder.events == [.cancel])
    #expect(!r.hasPendingPress)
    #expect(r.hasGestureTaken)
    #expect(r.isPinching)
  }

  @Test("two fingers moving together pan and zoom, and the tool hears nothing")
  func pinchPansAndZooms() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(150, 150))
    r.began(B, at: Point(250, 150))
    host.recorder.events.removeAll()

    // Spread apart and shift right: zoom in, and carry the map along.
    r.moved(A, to: Point(140, 150))
    r.moved(B, to: Point(280, 150))

    #expect(host.recorder.events.isEmpty)
    #expect(host.viewport.zoomLevel < 0)          // gap grew -> zoomed in
    #expect(host.viewport.targetX != 0 || host.viewport.targetY != 0)
  }

  @Test("the finger left after a pinch cannot start a stroke")
  func leftoverFingerIsInert() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(150, 150))
    r.began(B, at: Point(250, 150))
    r.ended(B, at: Point(250, 150))
    host.recorder.events.removeAll()

    r.moved(A, to: Point(160, 160))
    r.ended(A, at: Point(160, 160))

    #expect(host.recorder.events.isEmpty)
    // Only now, with the last finger gone, is the gesture over.
    #expect(!r.hasGestureTaken)
    #expect(r.activeTouches == 0)
  }

  @Test("a third finger is ignored, and the pinch stays on the first two")
  func thirdFingerIgnored() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(100, 150))
    r.began(B, at: Point(200, 150))
    let afterTwo = host.viewport.zoomLevel

    // This is the ordered-array regression test. A dictionary could pick any
    // two of the three, and the map would lurch as the pinch re-anchored.
    r.began(C, at: Point(390, 150))
    r.moved(C, to: Point(395, 150))

    #expect(r.activeTouches == 3)
    #expect(host.viewport.zoomLevel == afterTwo)   // C moving alone changes nothing
    #expect(host.recorder.events == [.cancel])     // only the second finger's cancel
  }

  @Test("a cancelled touch abandons the stroke without committing")
  func cancelAbandons() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(100, 100))
    r.moved(A, to: Point(130, 100))
    host.recorder.events.removeAll()

    r.cancelled(A)

    #expect(host.recorder.events == [.cancel])
    #expect(r.activeTouches == 0)
    #expect(!r.hasPendingPress)
  }

  @Test("the ghost does not linger after the finger lifts")
  func noHoverGhost() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    r.began(A, at: Point(100, 100))
    r.moved(A, to: Point(120, 100))
    #expect(host.mouseWorld != nil)
    r.ended(A, at: Point(120, 100))
    // There is no hover on iOS. A straight port of the web would park a cursor
    // ghost at the last touch point for the rest of the session.
    #expect(host.mouseWorld == nil)
  }

  @Test("a move measures its delta from where the finger landed")
  func deltaFromLanding() {
    let host = FakeHost()
    let r = PointerRouter(host: host)
    var seen: Double?
    final class Probe: Tool {
      let id = ToolId.wall
      var onMove: ((PointerInfo) -> Void)?
      func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext) { onMove?(e) }
      func preview() -> ToolPreview { .empty }
    }
    let probe = Probe()
    probe.onMove = { seen = $0.dxScreen }
    host.tool = probe

    r.began(A, at: Point(100, 100))
    r.moved(A, to: Point(137, 100))
    // 37, not 0: flushing the held press sets lastScreen to the landing point.
    #expect(seen == 37)
  }

  // MARK: - Panning with one finger

  /// Dragging with nothing armed used to do nothing whatsoever: `moved` ended
  /// in `host.tool?.onPointerMove`, and with no tool that optional chain is a
  /// no-op. Panning was two-fingers-only and the obvious gesture was dead.
  @Test("with no tool armed, one finger pans the map")
  func oneFingerPans() {
    let host = FakeHost()
    host.tool = nil
    let r = PointerRouter(host: host)
    let before = (host.viewport.targetX, host.viewport.targetY)

    r.began(A, at: Point(200, 150))
    r.moved(A, to: Point(240, 130))
    r.ended(A, at: Point(240, 130))

    // panBy subtracts the screen delta over the scale, so dragging right and up
    // moves the camera left and down -- the map follows the finger.
    let s = host.viewport.scale
    #expect(host.viewport.targetX == before.0 - 40 / s)
    #expect(host.viewport.targetY == before.1 - (-20) / s)
  }

  /// The regression that matters more than the feature: a tool armed must still
  /// draw, and must not drag the map out from under the stroke.
  @Test("with a tool armed, one finger draws and does not pan")
  func armedToolStillDraws() {
    let host = FakeHost()   // init arms the recorder
    let r = PointerRouter(host: host)
    let before = (host.viewport.targetX, host.viewport.targetY)

    r.began(A, at: Point(200, 150))
    r.moved(A, to: Point(240, 130))
    r.ended(A, at: Point(240, 130))

    #expect(host.viewport.targetX == before.0)
    #expect(host.viewport.targetY == before.1)
    #expect(host.recorder.events.contains(.move(host.viewport.screenToWorld(Point(240, 130)))))
    #expect(host.freePans == 0)
  }

  @Test("the host hears about a free pan only when nothing is armed")
  func tellsTheHost() {
    let host = FakeHost()
    host.tool = nil
    let r = PointerRouter(host: host)

    r.began(A, at: Point(200, 150))
    r.moved(A, to: Point(210, 150))
    r.moved(A, to: Point(220, 150))
    r.ended(A, at: Point(220, 150))
    // Once per move, which is exactly why the world guards it with a flag.
    #expect(host.freePans == 2)
  }

  /// The new branch sits after the pinch guard, so two fingers must be
  /// untouched by it -- including the tool-less case, which now has two ways to
  /// pan and must not apply both at once.
  @Test("two fingers still pinch, and do not also free-pan")
  func pinchUnaffected() {
    let host = FakeHost()
    host.tool = nil
    let r = PointerRouter(host: host)

    r.began(A, at: Point(100, 100))
    r.began(B, at: Point(200, 100))
    #expect(r.isPinching)
    r.moved(A, to: Point(90, 100))
    r.moved(B, to: Point(210, 100))

    // The pinch branch returns before the free-pan branch is reached.
    #expect(host.freePans == 0)
  }
}
