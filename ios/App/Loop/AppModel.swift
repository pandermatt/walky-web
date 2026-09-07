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
}

/// Owns the world, the loop and the observable shells around them.
@MainActor
final class AppModel {
  let world = WalkyWorld()
  let redraw = Redraw()
  let toolbar = ToolbarState()
  var notice: String?

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
    world.onToolChanged = { [weak self] id in self?.toolbar.selected = id }
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
    case .settings: break   // handled by the view, which owns the sheet
    }
    toolbar.canUndo = world.canUndo
    needsFrame()
  }

  private func show(_ message: String) {
    notice = message
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      if self?.notice == message { self?.notice = nil }
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

enum ToolbarAction { case start, resetPedestrians, undo, clear, resetZoom, settings }
