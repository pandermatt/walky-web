import Foundation

/// The eight numeric settings, and the one table their ranges live in.
///
/// Ports `SETTING_RANGES` at `src/state/model.ts:146`. It is deliberately one
/// table: the sliders are built from it *and* a map arriving from a link is
/// clamped through it, so `state/` never has to reach into `ui/` to find out
/// what a slider would have allowed.
public enum NumericSetting: String, CaseIterable, Sendable {
  case speed, pedestrianRadius, personalSpace, brushSize
  case generatorRate, borderThickness, labelSize, labelWeight

  public var range: (min: Double, max: Double, step: Double) {
    switch self {
    // Metres per second: a shuffle to a slow jog.
    case .speed:            return (0.4, 3, 0.05)
    case .pedestrianRadius: return (3, 40, 1)
    case .personalSpace:    return (0, 120, 1)
    case .brushSize:        return (1, 14, 1)
    // From somebody through the door every second to a stream the door itself
    // is the bottleneck on.
    case .generatorRate:    return (1, 20, 1)
    case .borderThickness:  return (2, 60, 1)
    // From a word that has to be zoomed in on to one that titles the whole map.
    case .labelSize:        return (8, 120, 1)
    // The face's own axis, in steps coarse enough that every stop is a
    // different weight rather than a different number.
    case .labelWeight:      return (100, 1000, 50)
    }
  }

  public var label: String {
    switch self {
    case .speed:            return "Speed"
    case .pedestrianRadius: return "Pedestrian size"
    case .personalSpace:    return "Personal space"
    case .brushSize:        return "Brush size"
    case .generatorRate:    return "Generator rate"
    case .borderThickness:  return "Border thickness"
    case .labelSize:        return "Label size"
    case .labelWeight:      return "Label weight"
    }
  }

  public var keyPath: ReferenceWritableKeyPath<Settings, Double> {
    switch self {
    case .speed:            return \.speed
    case .pedestrianRadius: return \.pedestrianRadius
    case .personalSpace:    return \.personalSpace
    case .brushSize:        return \.brushSize
    case .generatorRate:    return \.generatorRate
    case .borderThickness:  return \.borderThickness
    case .labelSize:        return \.labelSize
    case .labelWeight:      return \.labelWeight
    }
  }
}

/// What the sliders and toggles say. Ports `Settings` at `src/state/model.ts:33`.
///
/// A class, not a struct, and `@Observable` rather than `ObservableObject`.
/// Both choices are deliberate: the web keeps one mutable `settings` object
/// shared by the app and both panels (`app.ts:2183` warns against replacing
/// it), and `@Observable`'s per-property tracking means dragging one slider
/// invalidates only the views that read that property. `ObservableObject`'s
/// `objectWillChange` is object-granular and would re-render every panel on
/// every tick of every slider.
@Observable
public final class Settings {
  public var showVisibleLines = false
  public var showLineToTarget = true
  /// The dashed outline around each connected group of shapes.
  public var showConvexHull = true
  /// The convex *decomposition*: a diagnostic for how a shape was split, dense
  /// enough to bury the hull it would otherwise be confused with. Off by default.
  public var showConvexParts = false
  public var showPersonalSpace = false
  public var showDebug = false

  /// `AbstractPedestrian`'s default.
  public var pedestrianRadius: Double = 13
  /// The original's was 30. The brush no longer spaces a block by this, so a
  /// crowd is painted shoulder to shoulder and opens out to whatever it is set to.
  public var personalSpace: Double = 40
  /// The one setting in the world's units rather than the map's. The
  /// long-standing default of 4 px/tick turned out to be a 4.3 m/s jog; people
  /// walk at 1.34 m/s (Weidmann), so now they do here too.
  public var speed: Double = 1.35
  public var brushSize: Double = 1
  /// A steady trickle: fast enough to read as a flow within a second or two,
  /// slow enough that a door is not instantly its own traffic jam.
  public var generatorRate: Double = 4
  /// A little over two pedestrian diameters.
  public var labelSize: Double = 28
  public var labelWeight: Double = 1000
  /// Mostly cosmetic: what a pedestrian cannot cross is the bar expanded by its
  /// radius. The original used 2, which is a hairline on a modern display.
  public var borderThickness: Double = 12
  /// Whether a pedestrian plops when it reaches its goal.
  public var sound = true

  public init() {}

  /// Holds every numeric setting to its own range, as a slider would have.
  /// What a map out of a link goes through -- a value from a link is untrusted.
  public func clamp() {
    for s in NumericSetting.allCases {
      let r = s.range
      self[keyPath: s.keyPath] = jsMin(r.max, jsMax(r.min, self[keyPath: s.keyPath]))
    }
  }
}

/// The settings a tool is allowed to see: a value, not the shared reference.
///
/// `ToolContext.settings()` returns `Readonly<Settings>` in TypeScript, which
/// is a compile-time fiction -- handing over the object itself would let a tool
/// write through it. A snapshot cannot, and it makes a tool testable with four
/// numbers instead of a whole observable object.
public struct SettingsSnapshot: Sendable {
  public var pedestrianRadius: Double
  public var personalSpace: Double
  public var brushSize: Double
  public var borderThickness: Double

  public init(pedestrianRadius: Double, personalSpace: Double,
              brushSize: Double, borderThickness: Double) {
    self.pedestrianRadius = pedestrianRadius
    self.personalSpace = personalSpace
    self.brushSize = brushSize
    self.borderThickness = borderThickness
  }

  public init(_ s: Settings) {
    self.init(pedestrianRadius: s.pedestrianRadius, personalSpace: s.personalSpace,
              brushSize: s.brushSize, borderThickness: s.borderThickness)
  }
}
