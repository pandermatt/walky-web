import SwiftUI
import Observation
import WalkyCore

/// The one thing the map view observes.
///
/// A single counter, bumped when a frame is wanted. `WalkyWorld` itself is
/// deliberately *not* observable: `Agents.x` is an array mutated sixty times a
/// second, and reachable through an observed property it would fire change
/// tracking on every write. Read `version` in a view's `body` -- not inside a
/// `Canvas` renderer closure, which may run outside a tracked scope.
@Observable
final class Redraw {
  var version: UInt64 = 0
}

/// What the toolbar shows. Separate from `Redraw` so that arming a tool does
/// not repaint the map, and stepping the crowd does not re-evaluate the bar.
@Observable
final class ToolbarState {
  var selected: ToolId?
  var running = false
  var canUndo = false
  /// Whether there is a measurement to clear.
  var hasMeasurement = false
}

/// The transient line above the map.
///
/// Its own observable shell, for the same reason `Redraw` and `ToolbarState`
/// are: `AppModel` is deliberately *not* `@Observable` -- it carries `fps` and
/// `tps`, which change every second, and `tick` already documents what happens
/// when a view is invalidated underneath a finger that is still down.
///
/// `notice` used to be a plain property on `AppModel`, so nothing observed it
/// and the capsule never appeared at all. `GoalTool`'s "tap a wall to make it
/// the goal" had been unreachable since it was written.
@Observable
final class Notice {
  var message: String?
}

/// How many pedestrians there are, for the banner that counts them.
///
/// Its own shell rather than a field on `ToolbarState`, which would invalidate
/// `ToolbarView` on every brush point -- the bug in `tick` below, wearing a
/// different hat.
@Observable
final class Crowd {
  var count = 0
}

/// How many pedestrians the next goal would apply to. Its own shell, for the
/// same reason `Crowd` is: it changes on a gesture, and anything reading it in
/// `RootView.body` would rebuild the toolbar underneath the finger.
@Observable
final class Selection {
  var count = 0
}

/// Whether the app's own chrome is out of the way, for a clean capture.
///
/// The one shell `RootView.body` is *allowed* to read, and the exception proves
/// the rule the others follow: it changes only when somebody flips a switch or
/// taps an empty map, so at most a couple of times a session. `crowd.count` and
/// `selection.count` change while a finger is down, which is why they are read
/// in child views instead.
///
/// Not on `Settings`, and so not persisted: an app that relaunched with no
/// toolbar would read as broken rather than as tidy. One tap brings it back,
/// but only if you know that, and a fresh launch is exactly when you do not.
@Observable
final class Chrome {
  var hidden = false
}

/// Owns the world, the loop and the observable shells around them.
@MainActor
final class AppModel {
  let world = WalkyWorld()
  let redraw = Redraw()
  let basemap = Basemap()
  let importer = MapImporter()
  let scanner = RoomScanner()
  let detours = DetourRouter()
  let toolbar = ToolbarState()
  let notice = Notice()
  let crowd = Crowd()
  let selection = Selection()
  let chrome = Chrome()

  /// A sheet is over the map.
  ///
  /// Simulated time keeps running -- a settings sheet is not a pause, and the
  /// crowd should be where it would have been when you close it -- but there
  /// is no reason to *draw* a map nobody can see. The Canvas is the expensive
  /// half of a frame, and on a full crowd it was repainting sixty times a
  /// second behind an opaque sheet.
  var isCovered = false {
    didSet { if !isCovered { renderPending = true } }
  }

  private var link: CADisplayLink?
  private var renderPending = true

  /// Frames and ticks actually delivered in the last second.
  ///
  /// Measured where a frame is really painted rather than assumed from the
  /// display link's nominal rate -- `drawInformationString` had no frame rate
  /// to report, because Swing repainted on a timer and the number would have
  /// been the timer's.
  private(set) var fps = 0
  private(set) var tps = 0
  private var frameCount = 0
  private var tickCount = 0
  private var lastSecond = 0.0

  init() {
    world.onRequestRender = { [weak self] in self?.needsFrame() }
    world.onNotify = { [weak self] message in self?.show(message) }
    world.onToolChanged = { [weak self] id in
      self?.toolbar.selected = id
      if let hint = Self.armedHint(id) { self?.show(hint) }
    }
    // A scan ends with every sheet closed, so the room goes on the map by
    // itself and says what it was. See `RoomScanner.onScanned`.
    scanner.onScanned = { [weak self] in
      guard let self else { return }
      self.scanner.place(into: self.world)
    }
    scanner.onNotice = { [weak self] line in self?.show(line) }
    world.onDetourRequested = { [weak self] a, b in
      guard let self else { return }
      self.detours.route(from: a, to: b, world: self.world)
    }
    // The way back from a clean capture. Guarded rather than assigned, because
    // @Observable fires on every set and an idle tap is an ordinary thing to do
    // on a map with the controls already showing.
    world.onIdleTap = { [weak self] in
      guard let self, self.chrome.hidden else { return }
      self.chrome.hidden = false
    }
  }

  // MARK: - The loop

  /// One `CADisplayLink`, in `.common` modes.
  ///
  /// `.common` is what stops the crowd freezing while a slider is being
  /// dragged -- in the default mode a display link is suspended for the whole
  /// of a tracking gesture. `Timer` would have the same problem and is not
  /// vsync-aligned; `TimelineView(.animation)` would mean stepping the
  /// simulation from inside a view body, which is modifying state during an
  /// update and has nowhere to express the substep cap.
  ///
  /// Deliberately left at 60 Hz: opting into ProMotion needs
  /// `CADisableMinimumFrameDuration` and would halve the Core Graphics frame
  /// budget while buying nothing for simulated time, which is fixed at 60 by
  /// `Clock`. Revisit when the renderer is Metal.
  func start() {
    guard link == nil else { return }
    let proxy = DisplayLinkProxy { [weak self] link in self?.tick(link) }
    // A CADisplayLink retains its target, so the proxy holds the model weakly.
    let l = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.fire(_:)))
    l.add(to: .main, forMode: .common)
    link = l
  }

  func stop() {
    link?.invalidate()
    link = nil
    world.clock.reset()
  }

  private func tick(_ link: CADisplayLink) {
    // `link.timestamp` is seconds; Clock counts milliseconds.
    let before = world.simTicks
    if world.advance(link.timestamp * 1000) { renderPending = true }
    if world.running { renderPending = true }
    tickCount += world.simTicks - before
    if renderPending && !isCovered {
      renderPending = false
      // Before the frame, not inside it: the navigation rebuild is model work.
      world.prepareForRender()
      frameCount += 1
      redraw.version &+= 1
    }
    if link.timestamp - lastSecond >= 1 {
      fps = frameCount
      tps = tickCount
      frameCount = 0
      tickCount = 0
      lastSecond = link.timestamp
    }
    // Written only on change, and that is not an optimisation.
    //
    // `@Observable`'s generated setter calls `withMutation` on every set,
    // whether or not the value differs -- so assigning these unconditionally
    // invalidated ToolbarView sixty times a second, rebuilding its Buttons
    // underneath a finger that was still down. A tap spanning two frames was
    // landing on a button that no longer existed, which is what made play/pause
    // miss every second or third press.
    if toolbar.running != world.running { toolbar.running = world.running }
    if toolbar.canUndo != world.canUndo { toolbar.canUndo = world.canUndo }
    let measured = world.measurement != nil
    if toolbar.hasMeasurement != measured { toolbar.hasMeasurement = measured }
    // Mirrored here, and guarded for the same reason, because `agents.count`
    // never changes without either a `touch()` -- every edit: brush, wall, undo,
    // clear -- or a tick, and `touch()` un-pauses the link. So a tick always
    // follows a change within a frame, including the ones that make the crowd
    // *smaller*: a wall drawn over people, an undo, a clear.
    if crowd.count != world.agents.count { crowd.count = world.agents.count }
    // `Agents.selectionCount` is a scan, so this is one pass over a `[UInt8]`
    // per tick -- about 4 us at 4,000 agents against a 10.75 ms tick. A stored
    // counter would be five writers that must never disagree, to save 0.04%.
    let picked = world.agents.selectionCount
    if selection.count != picked { selection.count = picked }
  }

  private func needsFrame() {
    renderPending = true
    // A paused app still has a live link; it simply has nothing to do most
    // frames. Cheaper than tearing the link down and rebuilding it per edit.
    link?.isPaused = false
  }

  // MARK: - Actions

  func act(_ action: ToolbarAction) {
    switch action {
    case .start:
      world.play(!world.running)
      toolbar.running = world.running
    case .resetPedestrians: world.resetPedestrians()
    case .undo: world.undo()
    case .clear: world.clearAll()
    case .resetZoom: world.resetZoom()
    // The same flag the Recording switch in Settings writes; the menu is just
    // the short way to it. Disarming is `RootView`'s, keyed on the flag, so
    // both routes get it.
    case .hideControls: chrome.hidden = true
    case .clearMeasurement:
      detours.cancel()
      world.clearMeasurement()
    // Both raise a sheet, and the view owns the sheet.
    case .settings, .welcome: break
    }
    toolbar.canUndo = world.canUndo
    toolbar.hasMeasurement = world.measurement != nil
    needsFrame()
  }

  /// What to say when a tool is armed, for the two that live in the menu.
  ///
  /// The five tools in the bar need nothing: arming one lights its cell, and
  /// the pill travelling there is the whole answer to "did that work?". Measure
  /// and the door have no cell -- eight 44pt cells do not fit a 375pt phone --
  /// so arming either from the menu closes the menu and changes nothing you can
  /// see, and the next tap on the map then does something unasked for. A line
  /// of text is what the cell would have been.
  ///
  /// Both sentences name the gesture rather than the mode, because the mode is
  /// the part that was already invisible.
  private static func armedHint(_ id: ToolId?) -> String? {
    switch id {
    case .measure: "Tap two points to measure the walk between them."
    case .generator: "Tap a block to make people come out of it."
    default: nil
    }
  }

  private func show(_ message: String) {
    notice.message = message
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      if self?.notice.message == message { self?.notice.message = nil }
    }
  }
}

/// Holds the model weakly, because a `CADisplayLink` retains its target and
/// would otherwise keep the world alive and stepping for the life of the app.
private final class DisplayLinkProxy: NSObject {
  private let onFire: (CADisplayLink) -> Void
  init(_ onFire: @escaping (CADisplayLink) -> Void) { self.onFire = onFire }
  @objc func fire(_ link: CADisplayLink) { onFire(link) }
}

enum ToolbarAction {
  case start, resetPedestrians, undo, clear, resetZoom, settings, welcome
  case hideControls, clearMeasurement
}

