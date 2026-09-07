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
  /// Off, and `DEFAULT_SETTINGS` at `state/model.ts:104` was changed to match.
  ///
  /// Both this and the hull below used to start on. They are diagnostics, and
  /// on a map you have not drawn yet they are the *only* thing on the screen:
  /// orange thread hunting for a goal that does not exist, over dashed outlines
  /// of nothing. The web could carry that because its icon strip has hover
  /// tooltips to explain itself; `ui/tooltip.ts` says outright that those never
  /// appear on a touch device, which is how the phone ended up as the one
  /// surface with diagnostics on and no way to find out what they were.
  ///
  /// Changed in both ports rather than here alone. `clampSettings`
  /// (`state/scenario.ts:233`) falls a missing key back to `DEFAULT_SETTINGS`
  /// and `codec.ts:281` packs the toggles positionally, so had only this port
  /// moved, the same shared link would have decoded to a different picture in
  /// each app once the codec is ported. Agreeing removes that before it exists.
  public var showLineToTarget = false
  /// The dashed outline around each connected group of shapes. Off, and matched
  /// in the web app, for the reason above.
  public var showConvexHull = false
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

  /// How the chrome is lit. Dark by default: the app has one ground colour and
  /// always has, so inheriting the system's appearance was never right.
  ///
  /// Persisted, unlike every setting above it. A slider is part of the map you
  /// are building and belongs to the session; a theme is a statement about how
  /// you like the app, and forgetting it on every launch would make the picker
  /// a toy. The rest stay in memory until scenarios are ported and there is
  /// somewhere for a whole map to live.
  public var appearance: Appearance = .dark {
    didSet { defaults?.set(appearance.rawValue, forKey: Keys.appearance) }
  }

  /// What the crowd walks on, by id so the choice survives being stored.
  /// `Grounds.automatic` -- the default -- defers to `appearance`.
  public var groundId: String = Grounds.automatic {
    didSet { defaults?.set(groundId, forKey: Keys.ground) }
  }

  /// Whether the system is in dark mode, pushed in from the view layer:
  /// WalkyCore has no SwiftUI and cannot read it.
  ///
  /// Only ever *read* while `followsSystem` is true, which is the only time it
  /// is trustworthy -- the moment the app states a colour scheme of its own,
  /// what the view layer observes is that statement coming back rather than
  /// the system's own setting.
  public var systemIsDark: Bool = true

  /// The ground actually drawn.
  ///
  /// Appearance drives it, so choosing Light does what it says -- lights the
  /// map, not merely the settings sheet. Picking a ground outright overrides
  /// that and keeps overriding it, which is what a deliberate choice should
  /// do; Automatic is a row in the list, so the override is reversible.
  public var ground: Ground {
    guard groundId == Grounds.automatic else { return Grounds.named(groundId) }
    switch appearance {
    case .light: return Grounds.paper
    case .dark: return Grounds.classic
    case .system: return systemIsDark ? Grounds.classic : Grounds.paper
    }
  }

  /// True when the app should state no colour scheme at all and take the
  /// system's. Also the only condition under which `systemIsDark` can be read.
  public var followsSystem: Bool {
    appearance == .system && groundId == Grounds.automatic
  }

  /// The colour behind the armed tool. Persisted alongside the other two.
  public var accentId: String = Accents.orange.id {
    didSet { defaults?.set(accentId, forKey: Keys.accent) }
  }
  public var accent: Accent { Accents.named(accentId) }

  /// Whether the welcome sheet has already had its one uninvited showing.
  ///
  /// Not a preference -- nothing in the settings sheet shows it -- but it is a
  /// fact about this install that has to outlive a launch, and this is the one
  /// type that owns a store. `@AppStorage` would have worked and would have put
  /// a second persistence mechanism, and a raw key outside `Keys`, in the view
  /// layer; it would also be unreachable from `swift test`, which cannot load
  /// the app target at all.
  public var hasSeenWelcome = false {
    didSet { defaults?.set(hasSeenWelcome, forKey: Keys.welcome) }
  }

  private enum Keys {
    static let appearance = "walky.appearance"
    static let ground = "walky.ground"
    static let accent = "walky.accent"
    static let welcome = "walky.welcomeSeen"
  }

  /// Where the two persisted choices live. A property rather than a custom
  /// `init` because `@Observable` generates stored properties of its own, and
  /// an initialiser that has to satisfy them buys nothing here.
  ///
  /// Settable so a test can point at its own store instead of the simulator's.
  public var defaults: UserDefaults? = .standard

  /// Reads back what was stored. Called once at launch; deliberately explicit
  /// rather than hidden in an initialiser, so a test can construct a Settings
  /// without touching UserDefaults at all.
  public func restore() {
    if let raw = defaults?.string(forKey: Keys.appearance),
       let stored = Appearance(rawValue: raw) {
      appearance = stored
    }
    if let raw = defaults?.string(forKey: Keys.ground) {
      // Through `named` rather than assigned raw: a ground since renamed or
      // removed falls back to Classic, instead of leaving the app painting on
      // a ground that no longer exists. Automatic is not a ground and would
      // not survive that lookup, so it is checked first.
      groundId = raw == Grounds.automatic ? raw : Grounds.named(raw).id
    }
    if let raw = defaults?.string(forKey: Keys.accent) {
      accentId = Accents.named(raw).id
    }
    // `bool(forKey:)` is false for a key that was never written, which is
    // exactly what a fresh install should mean. Guarded on the store rather
    // than defaulted, so a Settings without one keeps its own false instead of
    // writing that false straight back out through `didSet`.
    if let defaults { hasSeenWelcome = defaults.bool(forKey: Keys.welcome) }
  }

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
