import Foundation
import WalkySim

/// The map, in and out of the world it lives in.
///
/// `Codec` and `ShareLink` have been ported since the state work and had
/// nothing to talk to: there was no way to get a `ScenarioCore` out of a
/// `WalkyWorld` or back into one. These two functions are that, and they are
/// ports of `serializeCore` and `buildWorld` (`src/state/scenario.ts:151,285`)
/// with the app's own half of `app.ts`'s import folded in -- the web keeps the
/// rebuild in the app because the app owns the arrays; here the world does.
///
/// Everything a saved map does goes through this pair: `.walky` files, and the
/// share links whose codec was waiting for it.
@MainActor
public extension WalkyWorld {
  /// The map as it stands.
  ///
  /// Coordinates are rounded, as the web rounds them, because the wire format
  /// stores whole units and a payload that disagrees with what was encoded
  /// would make every round-trip test a near-miss.
  func captureScenario() -> ScenarioCore {
    var serialWalls: [SerializedWall] = []
    serialWalls.reserveCapacity(walls.count)
    for wall in walls {
      serialWalls.append(SerializedWall(
        id: wall.id,
        polygons: wall.polygons.map { $0.map { Point(jsRound($0.x), jsRound($0.y)) } },
        color: wall.color,
        isGoal: wall.isGoal,
        isBorder: wall.isBorder))
    }

    var serialAgents: [SerializedAgent] = []
    serialAgents.reserveCapacity(agents.count)
    for i in 0..<agents.count {
      serialAgents.append(SerializedAgent(
        x: jsRound(Double(agents.x[i])),
        y: jsRound(Double(agents.y[i])),
        originX: jsRound(Double(agents.originX[i])),
        originY: jsRound(Double(agents.originY[i])),
        goal: Int(agents.goal[i]),
        arrived: agents.arrived[i] != 0,
        color: unpackRgb(agents.color[i]),
        spawned: agents.spawned[i] != 0))
    }

    // A generator is a wall in this port and a loose point in the format, so it
    // is written both ways: the point section keeps a v3 reader -- the web --
    // able to open the file, and `wallGenerators` is what makes an iOS
    // round-trip exact. `Codec` decides the version from whether that second
    // list is empty. See `CodecScenario.encodeBody`.
    var serialGenerators: [SerializedGenerator] = []
    var wallGenerators: [WallGeneratorRef] = []
    for (index, wall) in walls.enumerated() {
      guard let generator = wall.generator else { continue }
      wallGenerators.append(WallGeneratorRef(wallIndex: index,
                                             rate: generator.rate,
                                             goal: generator.goal))
      // Where a v3 reader will put its block: beside the wall rather than in
      // it, because a generator standing inside a wall is one that can never
      // let anybody out. `generatorMouth` is the same point this world emits
      // from, so the two ports behave alike as well as read alike.
      serialGenerators.append(SerializedGenerator(at: generatorMouth(wall),
                                                  rate: generator.rate,
                                                  goal: generator.goal,
                                                  color: wall.color))
    }

    return ScenarioCore(
      settings: settings,
      view: ScenarioView(targetX: jsRound(viewport.targetX),
                         targetY: jsRound(viewport.targetY),
                         zoomLevel: viewport.zoomLevel),
      walls: serialWalls,
      agents: serialAgents,
      labels: [],                       // the text tool is not ported; see ToolId
      generators: serialGenerators,
      wallGenerators: wallGenerators)
  }

  /// Replaces the map with a saved one.
  ///
  /// Ports `buildWorld` plus the application `app.ts` does around it, and keeps
  /// its two rules about trust, because a scenario is untrusted input whether
  /// it came out of a link or off the filesystem:
  ///
  /// - **Fresh ids, remapped goals.** The ids in a payload are not the ids this
  ///   map will have, so a goal is looked up through a map from old to new. One
  ///   naming a wall that did not survive is simply no goal, which is a state
  ///   the map already has a meaning for.
  /// - **Settings are copied field by field, never replaced.** `Settings` is a
  ///   reference the whole app holds -- `app.ts:2183` warns against swapping it
  ///   -- and `clampSettings` has already held every value to the range its own
  ///   slider would have allowed.
  func apply(_ core: ScenarioCore) {
    clearAll()

    let clamped = clampSettings(core.settings)
    for toggle in ToggleSetting.allCases {
      settings[keyPath: toggle.keyPath] = clamped[keyPath: toggle.keyPath]
    }
    for numeric in NumericSetting.allCases {
      settings[keyPath: numeric.keyPath] = clamped[keyPath: numeric.keyPath]
    }

    var newIdOf: [Int: Int] = [:]
    for saved in core.walls {
      let polygons = saved.polygons.filter { $0.count >= 3 }
      if polygons.isEmpty { continue }
      let wall = makeWall(polygons, WallOptions(color: saved.color, isBorder: saved.isBorder))
      wall.isGoal = saved.isGoal
      walls.append(wall)
      newIdOf[saved.id] = wall.id
    }

    for saved in core.agents {
      agents.addRestored(Point(saved.x, saved.y),
                         origin: Point(saved.originX, saved.originY),
                         goalId: newIdOf[saved.goal] ?? -1,
                         // An arrived pedestrian is black, as `markArrived`
                         // makes it. Its stored colour is what it wore on the
                         // way, which is not what it looks like now.
                         rgb: saved.arrived ? BLACK : saved.color,
                         arrived: saved.arrived,
                         spawned: saved.spawned)
    }

    applyGenerators(core, newIdOf)

    // The camera the map was saved with, and the ceiling raised first so a
    // saved neighbourhood is not clamped back to the twenty notches a drawn map
    // opens with. Home is the saved level when that level is zoomed *in*, so
    // reset-zoom on an opened room goes back to the room rather than out to the
    // stop the app starts at.
    raiseZoomCeiling(for: contentBounds())
    viewport.targetX = core.view.targetX
    viewport.targetY = core.view.targetY
    viewport.zoomLevel = jsMax(ZOOM_LEVEL_MIN,
                               jsMin(viewport.zoomLevelMax, core.view.zoomLevel))
    viewport.homeLevel = jsMin(0, viewport.zoomLevel)

    markNavDirty()
    touch()
  }

  /// Generators, from whichever of the two lists the payload carried.
  ///
  /// A file this app wrote names the walls (`wallGenerators`) and is exact. A
  /// file the web wrote carries points, and a point is turned back into a wall
  /// the only way it can be: the wall it stands on if it stands on one, and
  /// otherwise a small block of its own -- which is what the web draws there
  /// anyway, and what this tool used to place before generators became walls.
  private func applyGenerators(_ core: ScenarioCore, _ newIdOf: [Int: Int]) {
    if !core.wallGenerators.isEmpty {
      for ref in core.wallGenerators {
        guard ref.wallIndex >= 0, ref.wallIndex < core.walls.count,
              let id = newIdOf[core.walls[ref.wallIndex].id],
              let wall = walls.first(where: { $0.id == id }) else { continue }
        wall.generator = Generator(rate: ref.rate, goal: newIdOf[ref.goal] ?? -1)
      }
      return
    }

    for saved in core.generators {
      let goal = newIdOf[saved.goal] ?? -1
      if let standing = pickWall(saved.at), standing.generator == nil {
        standing.generator = Generator(rate: saved.rate, goal: goal)
        continue
      }
      let half = Double(GENERATOR_CELLS) * settings.pedestrianRadius
      let block = makeWall([rectanglePolygon(Point(saved.at.x - half, saved.at.y - half),
                                            Point(saved.at.x + half, saved.at.y + half))],
                           WallOptions(color: saved.color))
      block.generator = Generator(rate: saved.rate, goal: goal)
      walls.append(block)
    }
  }
}
