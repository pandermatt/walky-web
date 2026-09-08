import Foundation

public struct Bounds {
  public var minX: Double, minY: Double, maxX: Double, maxY: Double
  public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
    self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY
  }
}

/// Camera, ported from `gui/ZoomMouseListener` via `src/render/viewport.ts`.
///
/// The original tracked an integer zoom *level* and multiplied the transform by
/// 1.1 per wheel notch, clamping to 50 steps in and 20 steps out. Keeping the
/// level as the source of truth (rather than a free-floating scale) reproduces
/// the original's exact zoom stops.
///
/// `toViewState()` is the one thing not ported -- it existed to hand deck.gl a
/// log2 zoom, and there is no deck.gl here.
///
/// Width and height are in **points**, not pixels. `UIView` hands touches in
/// points and its `CGContext` is already scaled by `contentScaleFactor`, so
/// working in points is what keeps world-to-screen sharing units with touches.
/// Replicating the web's explicit devicePixelRatio transform would double-scale
/// everything.
public let ZOOM_FACTOR: Double = 1.1
public let ZOOM_LEVEL_MIN: Double = -50   // most zoomed in
public let ZOOM_LEVEL_MAX: Double = 20    // most zoomed out

public struct Viewport {
  /// How far out this map may be zoomed.
  ///
  /// The stops come from `ZoomMouseListener`, where the whole world was a few
  /// hundred pixels of freehand drawing and 20 notches out was further than
  /// anyone needed. An imported neighbourhood is not that world: 260m at 56px
  /// to the metre is 14,560px across, which needs about 40 notches before it
  /// fits on a phone. So the ceiling is per-map rather than a constant, and
  /// stays at the original's stop for every map that is drawn rather than
  /// imported -- which is all of them on the web.
  public var zoomLevelMax: Double = ZOOM_LEVEL_MAX
  /// How far *in* `reset` may go, which is a different question from how far a
  /// pinch may.
  ///
  /// Zero for a drawn map: the app opens at the original's stop, that is where
  /// the drawing was authored, and a reset that zoomed in on one small wall
  /// would be a surprise rather than a reset. An imported map has a true size
  /// instead of an authored one, and a scanned room is *smaller* than the
  /// screen -- a 4m room at life size fits at two notches in, and clamping it
  /// back to zero would leave the crowd in a box in the middle of the display.
  /// So an import that frames itself says where home is, and everything else
  /// leaves this at zero and behaves exactly as it did.
  public var homeLevel: Double = 0
  public var targetX: Double = 0
  public var targetY: Double = 0
  /// Matches `ZoomMouseListener.startZoom`: higher means further out.
  public var zoomLevel: Double = 0
  public var width: Double = 1
  public var height: Double = 1

  public init() {}

  public var scale: Double { jsPow(ZOOM_FACTOR, -zoomLevel) }

  public func worldToScreen(_ p: Point) -> Point {
    let s = scale
    return Point(width / 2 + (p.x - targetX) * s,
                 height / 2 + (p.y - targetY) * s)
  }

  public func screenToWorld(_ p: Point) -> Point {
    let s = scale
    return Point((p.x - width / 2) / s + targetX,
                 (p.y - height / 2) / s + targetY)
  }

  /// World units per screen point -- how a tolerance in points becomes one in
  /// world units. `1 / scale`, named for the call sites that read it.
  public var worldPerPixel: Double { 1 / scale }

  /// Zoom by whole notches, keeping the world point under the cursor fixed.
  public mutating func zoomAt(_ screen: Point, _ notches: Double) {
    zoomAbout(screen, zoomLevel + notches)
  }

  /// Zoom by a scale ratio -- what a pinch measures -- about a screen point.
  ///
  /// Fingers have no detents, so this lands between the original's stops where
  /// the wheel never could. The level stays the source of truth either way; it
  /// simply stops being a whole number.
  public mutating func zoomByRatio(_ screen: Point, _ ratio: Double) {
    if !(ratio > 0) || !ratio.isFinite { return }
    zoomAbout(screen, zoomLevel - jsLog(ratio) / jsLog(ZOOM_FACTOR))
  }

  /// Move to a zoom level with one screen point left over the same world point.
  private mutating func zoomAbout(_ screen: Point, _ level: Double) {
    let before = screenToWorld(screen)
    zoomLevel = jsMax(ZOOM_LEVEL_MIN, jsMin(zoomLevelMax, level))
    let after = screenToWorld(screen)
    targetX += before.x - after.x
    targetY += before.y - after.y
  }

  /// Drag the view by a screen-space delta.
  public mutating func panBy(_ dxScreen: Double, _ dyScreen: Double) {
    let s = scale
    targetX -= dxScreen / s
    targetY -= dyScreen / s
  }

  public mutating func fit(_ bounds: Bounds, _ margin: Double = 60) {
    let w = jsMax(1, bounds.maxX - bounds.minX)
    let h = jsMax(1, bounds.maxY - bounds.minY)
    let wanted = jsMin(jsMax(1, width - margin * 2) / w,
                       jsMax(1, height - margin * 2) / h)
    // Snap to the nearest whole notch so the camera stays on the original's stops.
    let level = jsRound(-jsLog(wanted) / jsLog(ZOOM_FACTOR))
    zoomLevel = jsMax(ZOOM_LEVEL_MIN, jsMin(zoomLevelMax, level))
    targetX = (bounds.minX + bounds.maxX) / 2
    targetY = (bounds.minY + bounds.maxY) / 2
  }

  /// Back to the map: the starting zoom, with what has been drawn on screen.
  ///
  /// Resetting the zoom alone left the camera wherever it had been panned to,
  /// so after wandering off the drawing the button gave a blank screen.
  /// Recentring is what makes it a reset. A map too big to fit at the starting
  /// zoom keeps the level `fit` picks; the reset never zooms *in* past
  /// `homeLevel`.
  public mutating func reset(_ bounds: Bounds?) {
    guard let bounds else {
      zoomLevel = homeLevel; targetX = 0; targetY = 0
      return
    }
    fit(bounds)
    zoomLevel = jsMax(homeLevel, zoomLevel)
  }
}
