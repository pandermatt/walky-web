import Foundation

/// The tool vocabulary, ported from `src/tools/types.ts`.

public enum ToolId: String, CaseIterable, Sendable {
  case wall, rectangle, border, pedestrian, goal
  // Present in the web app, not in v1: select, shift, erase, text, generator.
}

/// The shape drawn under the pointer to say what the active tool will do.
///
/// Replaces the original's 32x32 PNG cursors, which could not show a tool's
/// actual dimensions -- they cannot grow with the pedestrian radius or the brush
/// size. On iOS there is no hover, so a ghost is drawn only while a touch is
/// down; see the note in the plan about offsetting it clear of the finger.
public enum GhostKind: Sendable { case square, squiggle, frame, target, eraser }

public struct CursorGhost: Sendable {
  public var kind: GhostKind
  public var at: Point
  /// Radius or half-extent, in world units.
  public var size: Double
  public init(kind: GhostKind, at: Point, size: Double) {
    self.kind = kind; self.at = at; self.size = size
  }
}

/// Lines from each pedestrian to the pointer, for the mark-goal tool.
public struct TargetLines: Sendable {
  public var to: Point
  /// Colour of the shape under the pointer, or nil to use each pedestrian's own.
  public var color: RGB?
  public init(to: Point, color: RGB?) { self.to = to; self.color = color }
}

/// Transient state a tool wants drawn on the overlay.
///
/// Every field has a default, so a tool writes only what it means -- the port of
/// `{ ...EMPTY_PREVIEW, pendingRect }`, except the compiler checks the names
/// where a spread would silently ignore a typo.
public struct ToolPreview: Sendable {
  public var pendingWallPoints: [Point] = []
  /// True while tracing freehand: draw as a closing outline, not placed vertices.
  public var pendingWallTracing = false
  public var pendingRect: (Point, Point)?
  /// Arbitrary outlines to preview, e.g. the bars of a border frame.
  public var pendingPolygons: [[Point]] = []
  /// Draw the pending outlines as a warning: the shape would be unusable.
  public var pendingPolygonsInvalid = false
  /// Where pedestrians would land if the brush fired now.
  public var pendingPedestrians: [Point] = []
  public var cursorGhost: CursorGhost?
  public var targetLines: TargetLines?

  public init() {}
  public static let empty = ToolPreview()
}

public struct PointerInfo: Sendable {
  public var world: Point
  public var screen: Point
  /// Screen-space movement since the last event, for drag handlers.
  public var dxScreen: Double
  public var dyScreen: Double
  /// Whether a modifier was held. Always false on a touchscreen.
  public var shiftKey: Bool
  /// Which buttons are held.
  ///
  /// The name survives the port on purpose. Every tool guards on
  /// `e.buttons !== 1` exactly as `tools/*.ts` does, so `WallTool.swift` still
  /// diffs against `wallTool.ts` line by line. iOS has no analogue, so it is
  /// synthesised: 1 from `touchesBegan` to `touchesEnded`, 0 after. Build these
  /// through `.down`/`.up` rather than writing the number at a call site.
  public var buttons: Int

  public static func down(world: Point, screen: Point,
                          dxScreen: Double = 0, dyScreen: Double = 0) -> PointerInfo {
    PointerInfo(world: world, screen: screen, dxScreen: dxScreen, dyScreen: dyScreen,
                shiftKey: false, buttons: 1)
  }

  public static func up(world: Point, screen: Point,
                        dxScreen: Double = 0, dyScreen: Double = 0) -> PointerInfo {
    PointerInfo(world: world, screen: screen, dxScreen: dxScreen, dyScreen: dyScreen,
                shiftKey: false, buttons: 0)
  }
}

/// What a tool is allowed to do to the world, kept narrow on purpose.
///
/// A struct of closures, as `app.ts:344` builds it. Twelve members rather than
/// the web's twenty-two: the other ten belong to tools outside v1, and each
/// should arrive with the tool that needs it. Built once in a `lazy var` with
/// `[unowned self]` -- a computed property would reallocate twelve closures on
/// every pointer event, and a strong capture would be a retain cycle.
public struct ToolContext {
  public var addWall: ([Point], WallOptions?) -> Bool
  /// Adds one wall made of several polygons, as a border frame is.
  public var addWallShape: ([[Point]], WallOptions?) -> Bool
  /// Current settings, for tools that need sizes at preview time.
  public var settings: () -> SettingsSnapshot
  /// Legal positions in a block centred on `at`, for placement and preview.
  public var pedestrianBlock: (Point, Int?) -> [Point]
  public var addPedestrians: (Point) -> Void
  /// Marks the wall under a point as a goal; false when there is no wall there.
  public var setGoalAt: (Point) -> Bool
  public var clearSelection: () -> Void
  /// Put the toolbar back to no active tool, so a one-shot cannot repeat.
  public var deactivateTool: () -> Void
  /// Say something to the user, as the chip that shared maps and updates use.
  public var notify: (String) -> Void
  public var requestRender: () -> Void
  /// Colour of the wall under a point, if any -- used to tint the goal preview.
  public var colorAt: (Point) -> RGB?
  /// World units per screen point, so tolerances can be expressed in points.
  public var worldPerPixel: () -> Double

  public init(
    addWall: @escaping ([Point], WallOptions?) -> Bool,
    addWallShape: @escaping ([[Point]], WallOptions?) -> Bool,
    settings: @escaping () -> SettingsSnapshot,
    pedestrianBlock: @escaping (Point, Int?) -> [Point],
    addPedestrians: @escaping (Point) -> Void,
    setGoalAt: @escaping (Point) -> Bool,
    clearSelection: @escaping () -> Void,
    deactivateTool: @escaping () -> Void,
    notify: @escaping (String) -> Void,
    requestRender: @escaping () -> Void,
    colorAt: @escaping (Point) -> RGB?,
    worldPerPixel: @escaping () -> Double
  ) {
    self.addWall = addWall
    self.addWallShape = addWallShape
    self.settings = settings
    self.pedestrianBlock = pedestrianBlock
    self.addPedestrians = addPedestrians
    self.setGoalAt = setGoalAt
    self.clearSelection = clearSelection
    self.deactivateTool = deactivateTool
    self.notify = notify
    self.requestRender = requestRender
    self.colorAt = colorAt
    self.worldPerPixel = worldPerPixel
  }
}

/// A tool. A class, not an enum: every one holds mutable per-stroke state and
/// the world keeps one long-lived instance each, exactly as `app.ts` does.
@MainActor
public protocol Tool: AnyObject {
  var id: ToolId { get }
  func onPointerDown(_ e: PointerInfo, _ ctx: ToolContext)
  func onPointerMove(_ e: PointerInfo, _ ctx: ToolContext)
  func onPointerUp(_ e: PointerInfo, _ ctx: ToolContext)
  func onDoubleTap(_ e: PointerInfo, _ ctx: ToolContext)
  /// Abandon anything in progress, e.g. on a second finger or a tool switch.
  func cancel()
  func preview() -> ToolPreview
}

/// The port of TypeScript's optional methods.
public extension Tool {
  func onPointerDown(_: PointerInfo, _: ToolContext) {}
  func onPointerMove(_: PointerInfo, _: ToolContext) {}
  func onPointerUp(_: PointerInfo, _: ToolContext) {}
  func onDoubleTap(_: PointerInfo, _: ToolContext) {}
  func cancel() {}
}

/// Past this, a press-and-release counts as a drag rather than a tap.
///
/// **Deliberate divergence from the web app.** `rectangleTool.ts:42` and
/// `borderTool.ts:48` compare this constant -- documented as pixels -- against a
/// *world-space* distance, where `wallTool.ts:56` and `textTool.ts:36` correctly
/// multiply by `worldPerPixel()`. At zoom level 0 the two readings coincide,
/// which is why it has never shown on a desktop. On a phone, where people pinch
/// constantly, they diverge: zoomed out five notches a 6-unit drag is under 4pt
/// of finger travel, so every tap becomes a drag and two-tap mode is
/// unreachable. Both tools here multiply. The same one-line fix is filed
/// against the web app separately.
public let DRAG_THRESHOLD: Double = 6

@inline(__always)
func snap(_ p: Point) -> Point { Point(jsRound(p.x), jsRound(p.y)) }
