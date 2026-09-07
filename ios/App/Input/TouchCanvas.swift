import SwiftUI
import UIKit
import WalkyCore

/// The canvas's touch surface.
///
/// Deliberately thin: it translates `UITouch` into a point and hands it to
/// `PointerRouter`, which lives in `WalkyCore` and is unit-tested. Everything
/// subtle -- the withheld press, the second finger retracting it, the pinch --
/// is over there, where it can be driven by a script on a machine with no
/// simulator.
///
/// Raw touches rather than gesture recognisers. A `UIPinchGestureRecognizer`
/// or SwiftUI's `MagnificationGesture` only decides after a threshold, by which
/// time the drag has already told a tool to drop a block of pedestrians that no
/// `cancel()` can take back.
struct TouchCanvas: UIViewRepresentable {
  let router: PointerRouter

  func makeUIView(context: Context) -> WalkyTouchView {
    let v = WalkyTouchView()
    v.router = router
    return v
  }

  func updateUIView(_ view: WalkyTouchView, context: Context) { view.router = router }
}

final class WalkyTouchView: UIView {
  var router: PointerRouter?

  override init(frame: CGRect) {
    super.init(frame: frame)
    // Without this there is no pinch, ever: UIKit delivers only one touch.
    isMultipleTouchEnabled = true
    isOpaque = false
    backgroundColor = .clear

    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(onDoubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    // Deliberately without `require(toFail:)`: the web gets `dblclick`
    // alongside its pointer events rather than instead of them, and the wall
    // tool depends on both arriving.
    doubleTap.delaysTouchesEnded = false
    addGestureRecognizer(doubleTap)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("not from a nib") }

  private func at(_ t: UITouch) -> Point {
    // Points, not pixels: the view's CGContext is already scaled by
    // contentScaleFactor, so working in points is what keeps world-to-screen
    // sharing units with touches.
    let p = t.location(in: self)
    return Point(Double(p.x), Double(p.y))
  }

  private func id(_ t: UITouch) -> TouchId { TouchId(ObjectIdentifier(t).hashValue) }

  // One call per touch: UIKit batches them into a set where the web delivers
  // one event each, and the router's finger-count rules depend on seeing them
  // one at a time.
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { router?.began(id(t), at: at(t)) }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { router?.moved(id(t), to: at(t)) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { router?.ended(id(t), at: at(t)) }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches { router?.cancelled(id(t)) }
  }

  @objc private func onDoubleTap(_ g: UITapGestureRecognizer) {
    let p = g.location(in: self)
    router?.doubleTapped(at: Point(Double(p.x), Double(p.y)))
  }
}
