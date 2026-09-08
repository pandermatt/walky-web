import Foundation
import WalkySim

/// Ports `web/src/state/scenario.ts`.
///
/// Only the part a *link* carries. The JSON report's timestamp, summary and
/// stuck flags are descriptive or derived -- a link carrying them would be
/// claiming the sender's clock and the sender's navigation graph as facts about
/// the recipient's map -- so this is the narrower type the codec encodes.
public let SCENARIO_VERSION = 5

/// The order the toggle bits are packed in.
///
/// **Append only: the position is the format.** Ports `TOGGLE_KEYS` at
/// `state/codec.ts:281`, and exists for the same reason `NumericSetting` does --
/// one table read by both the writer and the reader, so a bit cannot be written
/// at one index and read at another.
public enum ToggleSetting: Int, CaseIterable, Sendable {
  case showVisibleLines = 0
  case showLineToTarget
  case showConvexHull
  case showConvexParts
  case showPersonalSpace
  case showDebug
  case sound

  public var keyPath: ReferenceWritableKeyPath<Settings, Bool> {
    switch self {
    case .showVisibleLines:  return \.showVisibleLines
    case .showLineToTarget:  return \.showLineToTarget
    case .showConvexHull:    return \.showConvexHull
    case .showConvexParts:   return \.showConvexParts
    case .showPersonalSpace: return \.showPersonalSpace
    case .showDebug:         return \.showDebug
    case .sound:             return \.sound
    }
  }
}

extension NumericSetting {
  /// The order the numeric settings are packed in. Append only, as above.
  ///
  /// `labelSize` is deliberately absent, and so are `generatorRate` and
  /// `labelWeight`. Appending here is not additive over the wire the way
  /// appending a block is: every link ever made would be one varint short, and
  /// the reader would take the view that follows for the setting and misread the
  /// rest of the map. Ports `NUMBER_KEYS` at `state/codec.ts:296`.
  public static let wireOrder: [NumericSetting] = [
    .speed, .pedestrianRadius, .personalSpace, .brushSize, .borderThickness,
  ]
}

/// A pedestrian as it is stored: where it is, where it started, what it is
/// doing. Everything else -- waypoint, step budget, distance to goal -- is
/// recomputed from the map on the next tick.
public struct SerializedAgent: Sendable, Equatable {
  public var x: Double
  public var y: Double
  public var originX: Double
  public var originY: Double
  /// Goal wall id, or -1 when unassigned.
  public var goal: Int
  public var arrived: Bool
  public var color: RGB
  /// Whether a generator let this one out; see `Agents.spawned`.
  public var spawned: Bool

  public init(x: Double, y: Double, originX: Double, originY: Double,
              goal: Int, arrived: Bool, color: RGB, spawned: Bool = false) {
    self.x = x; self.y = y; self.originX = originX; self.originY = originY
    self.goal = goal; self.arrived = arrived; self.color = color; self.spawned = spawned
  }

  public static func == (a: Self, b: Self) -> Bool {
    a.x == b.x && a.y == b.y && a.originX == b.originX && a.originY == b.originY
      && a.goal == b.goal && a.arrived == b.arrived && a.spawned == b.spawned
      && a.color == b.color
  }
}

/// A generator as it is stored. Its footprint derives from the pedestrian radius
/// and its emission counter belongs to the run, so neither travels.
public struct SerializedGenerator: Sendable, Equatable {
  public var at: Point
  public var rate: Double
  /// Goal wall id, or -1 when unassigned.
  public var goal: Int
  public var color: RGB

  public init(at: Point, rate: Double, goal: Int, color: RGB) {
    self.at = at; self.rate = rate; self.goal = goal; self.color = color
  }

  public static func == (a: Self, b: Self) -> Bool {
    a.at == b.at && a.rate == b.rate && a.goal == b.goal && a.color == b.color
  }
}

/// A label as it is stored: where the word sits, the word, and how big it is.
public struct SerializedLabel: Sendable, Equatable {
  public var at: Point
  public var text: String
  /// World-unit height and font weight, as the sliders were set when written.
  public var size: Double
  public var weight: Double

  public init(at: Point, text: String, size: Double, weight: Double) {
    self.at = at; self.text = text; self.size = size; self.weight = weight
  }
}

public struct SerializedWall: Sendable, Equatable {
  public var id: Int
  public var polygons: [[Point]]
  public var color: RGB
  public var isGoal: Bool
  /// Whether this wall is a border frame; see `Wall.isBorder`.
  public var isBorder: Bool

  public init(id: Int, polygons: [[Point]], color: RGB, isGoal: Bool, isBorder: Bool) {
    self.id = id; self.polygons = polygons; self.color = color
    self.isGoal = isGoal; self.isBorder = isBorder
  }

  public static func == (a: Self, b: Self) -> Bool {
    a.id == b.id && a.polygons == b.polygons && a.isGoal == b.isGoal
      && a.isBorder == b.isBorder && a.color == b.color
  }
}

/// A generator that is a wall, by the wall's index in the same payload.
///
/// The iOS port's own addition to the format, and the reason a map with a
/// generator on it is written as codec version 4. Indices rather than ids for
/// the reason goals use them: an index is a small number, and remapping onto
/// fresh ids is the importer's job.
public struct WallGeneratorRef: Sendable, Equatable {
  public var wallIndex: Int
  public var rate: Double
  /// Goal wall id, or -1 while it is not pinned anywhere.
  public var goal: Int

  public init(wallIndex: Int, rate: Double, goal: Int) {
    self.wallIndex = wallIndex; self.rate = rate; self.goal = goal
  }
}

/// Where the camera was pointing.
public struct ScenarioView: Sendable, Equatable {
  public var targetX: Double
  public var targetY: Double
  public var zoomLevel: Double

  public init(targetX: Double, targetY: Double, zoomLevel: Double) {
    self.targetX = targetX; self.targetY = targetY; self.zoomLevel = zoomLevel
  }
}

/// Everything a map *is*: what a shared link carries and what an import restores.
///
/// Not `Sendable`, because `Settings` is a reference type the whole app shares
/// on purpose -- `app.ts:2183` warns against replacing it, and the port keeps
/// that. A decoded scenario is handed straight to the world on the main actor.
public struct ScenarioCore {
  public var version: Int
  public var settings: Settings
  public var view: ScenarioView
  public var walls: [SerializedWall]
  public var agents: [SerializedAgent]
  /// Empty rather than absent: a payload written before labels existed is a map
  /// with nothing written on it, not a map that failed to load. The same for
  /// generators.
  public var labels: [SerializedLabel]
  public var generators: [SerializedGenerator]
  /// The same generators again, named by the wall they are. Empty in anything
  /// the web wrote, and empty in anything this app wrote before generators
  /// became walls -- which is exactly when a file can stay at version 3.
  public var wallGenerators: [WallGeneratorRef]

  public init(version: Int = SCENARIO_VERSION, settings: Settings, view: ScenarioView,
              walls: [SerializedWall], agents: [SerializedAgent],
              labels: [SerializedLabel] = [], generators: [SerializedGenerator] = [],
              wallGenerators: [WallGeneratorRef] = []) {
    self.version = version; self.settings = settings; self.view = view
    self.walls = walls; self.agents = agents
    self.labels = labels; self.generators = generators
    self.wallGenerators = wallGenerators
  }
}

/// Holds every setting to its own range and to its slider's own grid.
///
/// Ports `clampSettings` at `state/scenario.ts:232`. What a map arriving from a
/// link goes through: a link is untrusted input, and 1.30000000000004 is not a
/// value a slider can hold.
///
/// Snapped to the slider's grid rather than to whole numbers -- speed moved to
/// metres per second with a step of 0.05, and rounding it to an integer would
/// quietly rewrite every loaded map's pace.
public func clampSettings(_ input: Settings) -> Settings {
  let out = Settings()
  out.defaults = nil   // a decoded map must not write itself into the store
  for toggle in ToggleSetting.allCases {
    out[keyPath: toggle.keyPath] = input[keyPath: toggle.keyPath]
  }
  for setting in NumericSetting.allCases {
    let value = input[keyPath: setting.keyPath]
    guard value.isFinite else { continue }
    let r = setting.range
    let clamped = jsMin(r.max, jsMax(r.min, value))
    out[keyPath: setting.keyPath] = quantise(clamped, step: r.step)
  }
  return out
}

/// `Number((Math.round(v / step) * step).toFixed(4))`.
///
/// The `toFixed` is not decoration: 12 * 0.05 is 0.6000000000000001, and that is
/// not a number to show beside a slider. Four places is what the TypeScript
/// uses, and the step grid is coarse enough that nothing legitimate is lost.
private func quantise(_ value: Double, step: Double) -> Double {
  let snapped = jsRound(value / step) * step
  // Half away from zero at the fourth place, which is what toFixed does for
  // magnitudes this small. Written through `jsRound` on the scaled value so the
  // rounding rule is the one the rest of the port already uses.
  return jsRound(snapped * 10_000) / 10_000
}
