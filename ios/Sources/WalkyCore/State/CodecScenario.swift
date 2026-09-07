import Foundation
import WalkySim

// MARK: - header

extension Codec {
  public static func header(flags: Int) -> [UInt8] {
    [MAGIC, VERSION, UInt8(truncatingIfNeeded: flags)]
  }

  /// Splits a payload into its flags and its body, checking the header is one
  /// this build can read. Nothing is decoded here -- the body may still be
  /// deflated.
  public static func readHeader(_ bytes: [UInt8]) throws -> (flags: Int, body: [UInt8]) {
    guard bytes.count >= 3 else { throw ScenarioLinkError.truncated }
    guard bytes[0] == MAGIC else { throw ScenarioLinkError.notWalky }
    guard bytes[1] == VERSION else { throw ScenarioLinkError.wrongVersion }
    let flags = Int(bytes[2])
    guard flags & ~KNOWN_FLAGS == 0 else { throw ScenarioLinkError.wrongVersion }
    return (flags, Array(bytes.dropFirst(3)))
  }

  /// The flags a body written from this map needs announcing in the header.
  ///
  /// Set only when there is something to announce, which is what keeps a map
  /// with no labels on it byte-identical to what an older build wrote, and
  /// readable by one.
  public static func bodyFlags(_ core: ScenarioCore) -> Int {
    FLAG_SPEED_MPS
      | (core.labels.isEmpty ? 0 : FLAG_LABELS)
      | (core.generators.isEmpty ? 0 : FLAG_GENERATORS)
  }
}

// MARK: - writing

extension Codec {
  /// The scenario as bytes: a three-byte header followed by the body.
  public static func encode(_ core: ScenarioCore) -> [UInt8] {
    header(flags: bodyFlags(core)) + encodeBody(core)
  }

  /// The body alone, which is the part a share link may deflate.
  public static func encodeBody(_ core: ScenarioCore) -> [UInt8] {
    var w = Writer()
    let s = core.settings

    var toggles = 0
    for t in ToggleSetting.allCases where s[keyPath: t.keyPath] { toggles |= 1 << t.rawValue }
    w.varint(toggles)
    // Speed rides as centi-m/s (see FLAG_SPEED_MPS); the rest are whole pixels.
    for key in NumericSetting.wireOrder {
      let v = s[keyPath: key.keyPath]
      w.varint(key == .speed ? jsRound(v * 100) : v)
    }

    w.zigzag(jsRound(core.view.targetX * VIEW_QUANTUM))
    w.zigzag(jsRound(core.view.targetY * VIEW_QUANTUM))
    w.zigzag(jsRound(core.view.zoomLevel * ZOOM_QUANTUM))

    // One cursor for every vertex of every shape of every wall, and a second for
    // the crowd. A map drawn at x=3000 costs the 3000 once, not once per ring.
    w.varint(core.walls.count)
    var cx: Double = 0
    var cy: Double = 0
    var previousId = 0
    for (index, wall) in core.walls.enumerated() {
      // Two flags so far and a whole byte for them: the room is what let the
      // border flag be added without the format needing a new version.
      w.byte((wall.isGoal ? WALL_IS_GOAL : 0) | (wall.isBorder ? WALL_IS_BORDER : 0))
      w.rgb(wall.color)
      // Ids run upward from a counter that never resets, so after the first a
      // delta is almost always a single byte.
      if index == 0 { w.varint(wall.id) } else { w.zigzag(Double(wall.id - previousId)) }
      previousId = wall.id

      w.varint(wall.polygons.count)
      for poly in wall.polygons {
        w.varint(poly.count)
        for point in poly {
          let x = jsRound(point.x)
          let y = jsRound(point.y)
          w.zigzag(x - cx)
          w.zigzag(y - cy)
          cx = x
          cy = y
        }
      }
    }

    // Goals travel as the wall's index in this payload, not its id: an index is
    // a smaller number, and remapping onto fresh ids is the importer's job.
    var indexOfId: [Int: Int] = [:]
    for (i, wall) in core.walls.enumerated() { indexOfId[wall.id] = i }

    w.varint(core.agents.count)
    var ax: Double = 0
    var ay: Double = 0
    var previousColor = -1
    for agent in core.agents {
      let x = jsRound(agent.x)
      let y = jsRound(agent.y)
      let ox = jsRound(agent.originX)
      let oy = jsRound(agent.originY)
      let color = (agent.color.r << 16) | (agent.color.g << 8) | agent.color.b

      var bits = agent.arrived ? AGENT_ARRIVED : 0
      if agent.spawned { bits |= AGENT_SPAWNED }
      // A pedestrian that has not moved yet -- every one on a map that has not
      // been run -- pays nothing for its origin.
      if ox != x || oy != y { bits |= AGENT_ORIGIN_DIFFERS }
      // A crowd heading for one goal wears one colour, so this is usually set
      // and the whole crowd costs three bytes between them.
      if color == previousColor { bits |= AGENT_COLOR_REPEATS }
      w.byte(bits)

      w.zigzag(x - ax)
      w.zigzag(y - ay)
      if bits & AGENT_ORIGIN_DIFFERS != 0 { w.zigzag(ox - x); w.zigzag(oy - y) }
      if bits & AGENT_COLOR_REPEATS == 0 { w.rgb(agent.color) }

      w.varint((indexOfId[agent.goal].map { $0 + 1 }) ?? 0)

      ax = x
      ay = y
      previousColor = color
    }

    // Last, and only when there are any: a reader that does not know about
    // labels stops here, and the flag in the header is what stops it before it
    // starts rather than after it has read a map missing its tail.
    if !core.labels.isEmpty {
      w.varint(core.labels.count)
      var lx: Double = 0
      var ly: Double = 0
      for label in core.labels {
        let x = jsRound(label.at.x)
        let y = jsRound(label.at.y)
        w.zigzag(x - lx)
        w.zigzag(y - ly)
        w.varint(label.size)
        w.varint(label.weight)
        w.string(label.text)
        lx = x
        ly = y
      }
    }

    // After the labels, the same bargain one block further along.
    if !core.generators.isEmpty {
      w.varint(core.generators.count)
      var gx: Double = 0
      var gy: Double = 0
      for generator in core.generators {
        let x = jsRound(generator.at.x)
        let y = jsRound(generator.at.y)
        w.zigzag(x - gx)
        w.zigzag(y - gy)
        w.varint(generator.rate)
        w.rgb(generator.color)
        w.varint((indexOfId[generator.goal].map { $0 + 1 }) ?? 0)
        gx = x
        gy = y
      }
    }

    return w.bytes
  }
}

// MARK: - reading

extension Codec {
  /// A whole payload, header included, back into a scenario.
  public static func decode(_ bytes: [UInt8]) throws -> ScenarioCore {
    let (flags, body) = try readHeader(bytes)
    if flags & FLAG_DEFLATED != 0 {
      // Inflating is the share link's job; this entry point is the synchronous one.
      throw ScenarioLinkError("that link is packed and must be opened through a link reader")
    }
    return try decodeBody(body, flags: flags)
  }

  /// The body alone, once any deflate wrapper has been undone.
  ///
  /// `flags` says which optional blocks the header promised. It defaults to
  /// none, which is the honest reading of a body handed over without its header.
  public static func decodeBody(_ bytes: [UInt8], flags: Int = 0) throws -> ScenarioCore {
    var r = Reader(bytes)

    let loaded = Settings()
    loaded.defaults = nil   // a decoded map must not write itself into the store
    let toggles = Int(try r.varint())
    for t in ToggleSetting.allCases {
      loaded[keyPath: t.keyPath] = toggles & (1 << t.rawValue) != 0
    }
    for key in NumericSetting.wireOrder {
      let raw = try r.varint()
      // An old link's speed is the lattice's px-per-frame; through the exchange
      // rate it is the same walking pace it always was.
      loaded[keyPath: key.keyPath] = key != .speed ? raw
        : (flags & FLAG_SPEED_MPS != 0 ? raw / 100 : mpsFromPxPerTick(raw))
    }

    let view = ScenarioView(
      targetX: (try r.step(0)) / VIEW_QUANTUM,
      targetY: (try r.step(0)) / VIEW_QUANTUM,
      zoomLevel: jsMin(ZOOM_LEVEL_MAX, jsMax(ZOOM_LEVEL_MIN, (try r.zigzag()) / ZOOM_QUANTUM)))

    let wallCount = try r.count(CodecLimits.maxWalls, "walls")
    var walls: [SerializedWall] = []
    var cx: Double = 0
    var cy: Double = 0
    var previousId = 0
    for i in 0..<wallCount {
      let bits = try r.byte()
      let color = try r.rgb()
      let id = i == 0 ? Int(try r.varint()) : previousId + Int(try r.zigzag())
      previousId = id

      let polygonCount = try r.count(CodecLimits.maxPolygonsPerWall, "shapes in a wall")
      var polygons: [[Point]] = []
      for _ in 0..<polygonCount {
        let pointCount = try r.count(CodecLimits.maxPointsPerPolygon, "points in a shape")
        try r.ring(pointCount)
        var poly: [Point] = []
        poly.reserveCapacity(pointCount)
        for _ in 0..<pointCount {
          cx = try r.step(cx)
          cy = try r.step(cy)
          poly.append(Point(cx, cy))
        }
        polygons.append(poly)
      }
      walls.append(SerializedWall(id: id, polygons: polygons, color: color,
                                  isGoal: bits & WALL_IS_GOAL != 0,
                                  isBorder: bits & WALL_IS_BORDER != 0))
    }

    let agentCount = try r.count(CodecLimits.maxAgents, "pedestrians")
    var agents: [SerializedAgent] = []
    agents.reserveCapacity(agentCount)
    var ax: Double = 0
    var ay: Double = 0
    var previousColor: RGB = (0, 0, 0)
    for _ in 0..<agentCount {
      let bits = try r.byte()
      ax = try r.step(ax)
      ay = try r.step(ay)
      let ox = bits & AGENT_ORIGIN_DIFFERS != 0 ? try r.step(ax) : ax
      let oy = bits & AGENT_ORIGIN_DIFFERS != 0 ? try r.step(ay) : ay
      let color = bits & AGENT_COLOR_REPEATS != 0 ? previousColor : try r.rgb()
      previousColor = color
      let goalIndex = Int(try r.varint())
      // A goal naming no wall is dropped rather than refused: the pedestrian is
      // simply unassigned, which is a state the map already has a meaning for.
      let goal = goalIndex > 0 && goalIndex <= walls.count ? walls[goalIndex - 1].id : -1
      agents.append(SerializedAgent(x: ax, y: ay, originX: ox, originY: oy, goal: goal,
                                    arrived: bits & AGENT_ARRIVED != 0, color: color,
                                    spawned: bits & AGENT_SPAWNED != 0))
    }

    var labels: [SerializedLabel] = []
    if flags & FLAG_LABELS != 0 {
      let labelCount = try r.count(CodecLimits.maxLabels, "labels")
      var lx: Double = 0
      var ly: Double = 0
      for _ in 0..<labelCount {
        lx = try r.step(lx)
        ly = try r.step(ly)
        // Read in the order written: place, size, weight, word. The two numbers
        // are taken as given and clamped where every other untrusted number is.
        let size = try r.varint()
        let weight = try r.varint()
        labels.append(SerializedLabel(at: Point(lx, ly),
                                      text: try r.string(limit: CodecLimits.maxLabelBytes),
                                      size: size, weight: weight))
      }
    }

    var generators: [SerializedGenerator] = []
    if flags & FLAG_GENERATORS != 0 {
      let generatorCount = try r.count(CodecLimits.maxGenerators, "generators")
      var gx: Double = 0
      var gy: Double = 0
      for _ in 0..<generatorCount {
        gx = try r.step(gx)
        gy = try r.step(gy)
        let rate = try r.varint()
        let color = try r.rgb()
        let goalIndex = Int(try r.varint())
        let goal = goalIndex > 0 && goalIndex <= walls.count ? walls[goalIndex - 1].id : -1
        generators.append(SerializedGenerator(at: Point(gx, gy), rate: rate,
                                              goal: goal, color: color))
      }
    }

    // Everything decoded and bytes still to go: the payload is not what it says
    // it is. Better an error than a map quietly missing its tail.
    guard r.done else { throw ScenarioLinkError.truncated }

    return ScenarioCore(version: SCENARIO_VERSION, settings: clampSettings(loaded),
                        view: view, walls: walls, agents: agents,
                        labels: labels, generators: generators)
  }
}
