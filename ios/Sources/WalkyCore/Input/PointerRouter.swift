import Foundation

/// A touch's identity for the life of that touch. `ObjectIdentifier(UITouch)`
/// on iOS; anything stable in a test.
public struct TouchId: Hashable, Sendable {
  public let raw: Int
  public init(_ raw: Int) { self.raw = raw }
}

/// What the router needs from the world it drives.
///
/// Deliberately not `WalkyWorld` itself: this is the most intricate code in the
/// phase, and the whole point of it living in `WalkyCore` rather than the app
/// target is that it can be driven by a fake in a test on a machine with no
/// simulator.
@MainActor
public protocol PointerHost: AnyObject {
  var viewport: Viewport { get set }
  var tool: Tool? { get }
  var toolContext: ToolContext { get }
  /// Where the pointer last hovered, in world units. Nil on iOS except during a
  /// touch -- there is no hover, and a ghost parked at the last touch point is
  /// exactly the artefact to avoid.
  var mouseWorld: Point? { get set }
  func requestRender()
  /// A one-finger drag with no tool armed. Whether that is worth saying
  /// anything about is the host's business, not the router's -- the router
  /// knows the gesture happened; only the world knows whether the map is empty.
  func pannedWithoutTool()
  /// A one-finger tap that went nowhere, with no tool armed. The gesture that
  /// was free: with nothing armed a tap has never done anything at all, where a
  /// drag pans and a second finger pinches. That is what makes it safe to hang
  /// "bring the controls back" on, and the router stays ignorant of what the
  /// host does with it.
  func tappedWithoutTool()
}

/// The pointer and gesture state machine, ported from `app.ts:457–720`.
///
/// Everything about it that looks odd is load-bearing:
///
/// **A press is withheld.** On a touchscreen the tool hears about a press only
/// once the finger has moved or lifted, which is when it is certainly a stroke
/// rather than the first half of a pinch. A tool that has already dropped a
/// block of pedestrians or reassigned every goal cannot be talked out of it by
/// `cancel()`, and the second finger of a pinch always arrives after the first.
/// This is why SwiftUI's `DragGesture` + `MagnificationGesture` cannot be used:
/// by the time a magnification is recognised, `onChanged` has already fired.
///
/// **`pointers` is an ordered array, not a dictionary.** `measurePinch` takes
/// the first two fingers *in insertion order*; a dictionary would pick an
/// arbitrary two on a three-finger touch, and the map would lurch. Same hazard
/// as `Navigation.fieldOrder`, same fix.
///
/// **`gestureTaken` outlives the second finger.** It clears only when the last
/// finger lifts, so the finger still down after a pinch cannot start a stroke.
@MainActor
public final class PointerRouter {
  private unowned let host: PointerHost

  /// Every finger currently down, in view points, oldest first.
  private var pointers: [(id: TouchId, at: Point)] = []
  private var pinch: (gap: Double, mid: Point)?
  /// A press held back from the tool until it is certainly a stroke.
  private var pendingTouch: (id: TouchId, info: PointerInfo)?
  /// The pinch has claimed this gesture.
  private var gestureTaken = false
  /// Previous screen point: the only source of dxScreen/dyScreen.
  private var lastScreen: Point?
  /// Where the current one-finger gesture landed, for telling a tap from a drag
  /// at the lift. Not `pendingTouch`: that clears on the first `moved`, and a
  /// finger resting on glass reports movement of a point or two, so a tap
  /// measured that way would almost never register.
  private var pressScreen: Point?

  /// How far a finger may travel and still count as a tap, in screen points.
  /// The system's own figure for the same question.
  private static let TAP_SLOP: Double = 10

  public init(host: PointerHost) { self.host = host }

  // Exposed for tests, which is the reason this type exists apart from the app.
  public var activeTouches: Int { pointers.count }
  public var isPinching: Bool { pinch != nil }
  public var hasGestureTaken: Bool { gestureTaken }
  public var hasPendingPress: Bool { pendingTouch != nil }

  private func info(_ screen: Point, buttons: Int) -> PointerInfo {
    let dx = lastScreen.map { screen.x - $0.x } ?? 0
    let dy = lastScreen.map { screen.y - $0.y } ?? 0
    return PointerInfo(world: host.viewport.screenToWorld(screen), screen: screen,
                       dxScreen: dx, dyScreen: dy, shiftKey: false, buttons: buttons)
  }

  public func began(_ id: TouchId, at screen: Point) {
    pointers.append((id, screen))

    if pointers.count == 2 {
      // A second finger says the first one was never a stroke. Whatever it
      // began is taken back here, before the map starts moving under it.
      pendingTouch = nil
      host.tool?.cancel()
      lastScreen = nil
      gestureTaken = true
      pinch = measurePinch()
      host.requestRender()
      return
    }
    if pointers.count > 2 || gestureTaken { return }

    lastScreen = screen
    pressScreen = screen
    // Held rather than delivered -- see the note on the type.
    pendingTouch = (id, info(screen, buttons: 1))
  }

  public func moved(_ id: TouchId, to screen: Point) {
    if let i = pointers.firstIndex(where: { $0.id == id }) { pointers[i].at = screen }

    if let was = pinch {
      guard let now = measurePinch(), was.gap > 0 else { return }
      // The midpoint carries the map with it, so the same gesture pans: two
      // fingers travelling together are a drag, and holding the view still
      // under them would feel like the map had come loose.
      host.viewport.panBy(now.mid.x - was.mid.x, now.mid.y - was.mid.y)
      host.viewport.zoomByRatio(now.mid, now.gap / was.gap)
      pinch = now
      host.requestRender()
      return
    }
    if gestureTaken { return }
    if pendingTouch?.id == id { flushPendingTouch() }

    let e = info(screen, buttons: 1)
    // Computed before the pan, which is the honest answer to "what was under the
    // finger" at this instant, and keeps the debug readout's X/Y live.
    host.mouseWorld = e.world
    if host.tool == nil {
      // With nothing armed, one finger drags the map. It used to do nothing at
      // all: this line was `host.tool?.onPointerMove`, and with no tool that
      // optional chain is a no-op, so panning was two-fingers-only and the
      // obvious one-handed gesture was silently dead.
      //
      // `dxScreen`/`dyScreen` are already the right delta -- `flushPendingTouch`
      // sets `lastScreen` to the landing point precisely so the move delivered
      // next measures from it -- and the sign matches the two-finger branch
      // above, which pans by the midpoint's travel.
      host.viewport.panBy(e.dxScreen, e.dyScreen)
      host.pannedWithoutTool()
      host.requestRender()
    } else {
      host.tool?.onPointerMove(e, host.toolContext)
    }
    lastScreen = screen
  }

  public func ended(_ id: TouchId, at screen: Point) {
    let press = pressScreen
    pressScreen = nil
    if releasePointer(id) { return }
    if pendingTouch?.id == id { flushPendingTouch() }
    // Read *before* the lift is delivered. A tool that steps off itself on a
    // successful commit -- as the goal tool does -- would otherwise leave
    // `host.tool` nil by the time this ran, and its own assignment would be
    // indistinguishable from an idle tap on bare ground.
    let idle = host.tool == nil
    let e = info(screen, buttons: 0)
    host.tool?.onPointerUp(e, host.toolContext)
    if idle, let press,
       jsHypot(screen.x - press.x, screen.y - press.y) <= Self.TAP_SLOP {
      host.tappedWithoutTool()
    }
    lastScreen = nil
    // There is no hover on iOS: once the finger is gone the ghost should be too.
    host.mouseWorld = nil
    host.requestRender()
  }

  /// The system taking a gesture back mid-stroke: nothing was finished, so
  /// nothing should be committed.
  public func cancelled(_ id: TouchId) {
    _ = releasePointer(id)
    pendingTouch = nil
    pressScreen = nil
    host.tool?.cancel()
    lastScreen = nil
    host.mouseWorld = nil
    host.requestRender()
  }

  public func doubleTapped(at screen: Point) {
    let e = info(screen, buttons: 1)
    host.tool?.onDoubleTap(e, host.toolContext)
    host.requestRender()
  }

  private func measurePinch() -> (gap: Double, mid: Point)? {
    guard pointers.count >= 2 else { return nil }
    let a = pointers[0].at, b = pointers[1].at
    return (jsHypot(b.x - a.x, b.y - a.y), Point((a.x + b.x) / 2, (a.y + b.y) / 2))
  }

  private func flushPendingTouch() {
    guard let held = pendingTouch else { return }
    pendingTouch = nil
    // The *original* info: the tool sees the press where the finger landed, not
    // where it has moved to. `lastScreen` becomes that landing point, so the
    // move delivered next measures its delta from it.
    lastScreen = held.info.screen
    host.tool?.onPointerDown(held.info, host.toolContext)
  }

  /// Removes a finger. True when the release belonged to the pinch -- including
  /// the last finger of one, which is a leftover rather than the start of a
  /// stroke, and must not reach a tool.
  private func releasePointer(_ id: TouchId) -> Bool {
    pointers.removeAll { $0.id == id }
    let wasGesture = gestureTaken
    if pinch != nil && pointers.count < 2 { pinch = nil }
    else if pinch != nil { pinch = measurePinch() }
    if pointers.isEmpty { gestureTaken = false }
    if wasGesture { lastScreen = nil }
    return wasGesture
  }
}
