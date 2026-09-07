import Foundation

/// Checks this port against the fixtures V8 produced, bit for bit.
///
/// Bit patterns rather than values, everywhere. Two NaNs compare unequal and
/// `-0 == 0`, and both distinctions matter to a model that hashes positions.
/// There is no epsilon mode: in a chaotic crowd an approximate comparison
/// passes at tick 5 while concealing that the run is visibly wrong at tick 500,
/// which is worse than having no check at all.
public enum Conformance {

  public struct Mismatch {
    public let what: String
    public let index: Int
    public let got: String
    public let want: String
  }

  public struct GraphResult {
    public let name: String
    public let nodeCount: Int
    public let edgeCount: Int
    public let mismatches: [Mismatch]
    public var ok: Bool { mismatches.isEmpty }
  }

  /// Rebuilds a scenario's walls from its manifest.
  ///
  /// Ids are the manifest index: fixtures never carry the run-local ids that
  /// `model.ts` hands out, so the index *is* the identity on this side.
  public static func walls(from manifest: Manifest) -> [Wall] {
    manifest.walls.map { w in
      Wall(id: w.index,
           polygons: w.polygons.map { ring in ring.map { Point($0[0], $0[1]) } },
           color: (w.color[0], w.color[1], w.color[2]),
           isGoal: w.isGoal,
           isBorder: w.isBorder)
    }
  }

  public static func checkGraph(_ fixture: GraphFixture, _ manifest: Manifest) -> GraphResult {
    let built = buildVisibilityGraph(walls(from: manifest), manifest.radius)
    var bad: [Mismatch] = []

    /// Only the first few of any one kind: a shape mismatch would otherwise
    /// print thousands of lines that all say the same thing.
    func note(_ what: String, _ i: Int, _ got: String, _ want: String) {
      if bad.filter({ $0.what == what }).count < 3 {
        bad.append(Mismatch(what: what, index: i, got: got, want: want))
      }
    }

    guard built.nodes.count == fixture.nodeCount else {
      note("node count", 0, "\(built.nodes.count)", "\(fixture.nodeCount)")
      return GraphResult(name: fixture.name, nodeCount: built.nodes.count,
                         edgeCount: built.csr.targets.count, mismatches: bad)
    }

    for i in 0..<fixture.nodeCount {
      let g = built.nodes[i], w = fixture.nodes[i]
      if g.x.bitPattern != w.x.bitPattern || g.y.bitPattern != w.y.bitPattern {
        note("node position", i,
             "(\(g.x), \(g.y)) 0x\(String(g.x.bitPattern, radix: 16))/0x\(String(g.y.bitPattern, radix: 16))",
             "(\(w.x), \(w.y)) 0x\(String(w.x.bitPattern, radix: 16))/0x\(String(w.y.bitPattern, radix: 16))")
      }
      if built.nodeWall[i] != fixture.nodeWall[i] {
        note("nodeWall", i, "\(built.nodeWall[i])", "\(fixture.nodeWall[i])")
      }
      if built.nodePart[i] != fixture.nodePart[i] {
        note("nodePart", i, "\(built.nodePart[i])", "\(fixture.nodePart[i])")
      }
      if built.nodeRingIndex[i] != fixture.nodeRingIndex[i] {
        note("nodeRingIndex", i, "\(built.nodeRingIndex[i])", "\(fixture.nodeRingIndex[i])")
      }
      if built.ringLength[i] != fixture.ringLength[i] {
        note("ringLength", i, "\(built.ringLength[i])", "\(fixture.ringLength[i])")
      }
    }

    for i in 0...fixture.nodeCount where built.csr.offsets[i] != fixture.offsets[i] {
      note("csr offsets", i, "\(built.csr.offsets[i])", "\(fixture.offsets[i])")
    }

    guard built.csr.targets.count == fixture.edgeCount else {
      note("edge count", 0, "\(built.csr.targets.count)", "\(fixture.edgeCount)")
      return GraphResult(name: fixture.name, nodeCount: built.nodes.count,
                         edgeCount: built.csr.targets.count, mismatches: bad)
    }

    for e in 0..<fixture.edgeCount {
      if built.csr.targets[e] != fixture.targets[e] {
        note("csr target", e, "\(built.csr.targets[e])", "\(fixture.targets[e])")
      }
      if built.csr.weights[e].bitPattern != fixture.weights[e].bitPattern {
        note("csr weight", e,
             "\(built.csr.weights[e]) 0x\(String(built.csr.weights[e].bitPattern, radix: 16))",
             "\(fixture.weights[e]) 0x\(String(fixture.weights[e].bitPattern, radix: 16))")
      }
    }

    // One routing field per goal, in wall order -- which is the order
    // navigation.ts:148 round-robins over when it re-prices for congestion.
    let goalWalls = manifest.walls.filter(\.isGoal).map(\.index)
    if goalWalls.count != fixture.fields.count {
      note("goal count", 0, "\(goalWalls.count)", "\(fixture.fields.count)")
    } else {
      for (gi, wallIndex) in goalWalls.enumerated() {
        let field = fixture.fields[gi]
        if field.goalIndex != Int32(wallIndex) {
          note("goal order", gi, "\(wallIndex)", "\(field.goalIndex)")
          continue
        }
        let got = dijkstra(built.csr, nodesOfWall(built, wallIndex))
        for i in 0..<fixture.nodeCount {
          if got.dist[i].bitPattern != field.dist[i].bitPattern {
            note("dijkstra dist (goal \(wallIndex))", i,
                 "\(got.dist[i]) 0x\(String(got.dist[i].bitPattern, radix: 16))",
                 "\(field.dist[i]) 0x\(String(field.dist[i].bitPattern, radix: 16))")
          }
          if got.prev[i] != field.prev[i] {
            note("dijkstra prev (goal \(wallIndex))", i, "\(got.prev[i])", "\(field.prev[i])")
          }
        }
      }
    }

    return GraphResult(name: fixture.name, nodeCount: built.nodes.count,
                       edgeCount: built.csr.targets.count, mismatches: bad)
  }
}

// MARK: - Traces

extension Conformance {

  public struct TraceResult {
    public let name: String
    public let ticks: Int
    /// Ticks that matched before the first divergence; == ticks when identical.
    public let matchedTo: Int
    public let detail: String?
    public var ok: Bool { detail == nil }
  }

  /// One tick, in the order `App.stepOnce` takes it.
  ///
  /// The recost is why this exists rather than a bare `agents.step`. It is
  /// driven from app.ts:1751 on a `simTicks % RECOST_TICKS` cadence and never
  /// from inside the model, so a run without it re-prices no edges at all --
  /// and `tools/traceScenarios.ts` mirrors this exactly.
  public final class Runner {
    public let agents: Agents
    public let nav: Navigation
    public let hash: SpatialHash
    public let radius: Double
    public let speed: Double
    public let personalSpace: Double
    private var simTicks = 0

    public init(manifest: Manifest) {
      radius = manifest.radius
      speed = manifest.speed ?? 4
      personalSpace = manifest.personalSpace ?? 40
      let walls = Conformance.walls(from: manifest)
      nav = Navigation()
      nav.rebuild(walls, radius)
      agents = Agents()
      hash = SpatialHash()
      for p in manifest.agents ?? [] {
        // Colour is not in the trace and nothing in the model reads it, but the
        // goal's colour is what the generator passes, so pass the same.
        let rgb: RGB = p.goal >= 0 ? walls[p.goal].color : (255, 255, 255)
        let i = agents.add(Point(p.x, p.y), rgb)
        if p.goal >= 0 { agents.setGoal(i, walls[p.goal].id, rgb) }
      }
    }

    public func step() {
      agents.step(nav, hash, speed, radius, personalSpace)
      simTicks += 1
      if simTicks % RECOST_TICKS == 0 {
        nav.recost(hash, agents.x, agents.y, agents.count)
      }
    }
  }

  /// One tick's records, laid out exactly as `tools/traceFormat.ts` lays them.
  ///
  /// This layout is the contract between the two implementations: it is the one
  /// place they must agree about *encoding* rather than about the model, so it
  /// is written out longhand on both sides rather than derived.
  public static func packTick(_ a: Agents, into buffer: inout [UInt8]) -> Int {
    let need = a.count * TraceFixture.recordBytes
    if buffer.count < need { buffer = [UInt8](repeating: 0, count: need) }
    var o = 0
    func putF(_ v: Float) {
      let b = v.bitPattern
      buffer[o] = UInt8(b & 0xff); buffer[o + 1] = UInt8((b >> 8) & 0xff)
      buffer[o + 2] = UInt8((b >> 16) & 0xff); buffer[o + 3] = UInt8((b >> 24) & 0xff)
      o += 4
    }
    func putI(_ v: Int32) {
      let b = UInt32(bitPattern: v)
      buffer[o] = UInt8(b & 0xff); buffer[o + 1] = UInt8((b >> 8) & 0xff)
      buffer[o + 2] = UInt8((b >> 16) & 0xff); buffer[o + 3] = UInt8((b >> 24) & 0xff)
      o += 4
    }
    for i in 0..<a.count {
      putF(a.x[i]); putF(a.y[i]); putF(a.headingX[i]); putF(a.headingY[i])
      // The goal is already a wall *index* on this side: fixtures never carry
      // the run-local ids model.ts hands out, so walls are built with id = index.
      putI(a.goal[i])
      buffer[o] = a.arrived[i]; o += 1
      putI(a.party[i])
      putF(a.stalled[i]); putF(a.pressure[i])
    }
    return o
  }

  public static func fnv1a64(_ b: [UInt8], _ n: Int) -> UInt64 {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    let prime: UInt64 = 0x0000_0100_0000_01b3
    b.withUnsafeBufferPointer { raw in
      for i in 0..<n { h = (h ^ UInt64(raw[i])) &* prime }
    }
    return h
  }

  /// The names and offsets inside one record, for reporting which field split.
  private static let fields: [(String, Int, Int)] = [
    ("x", 0, 4), ("y", 4, 4), ("headingX", 8, 4), ("headingY", 12, 4),
    ("goal", 16, 4), ("arrived", 20, 1), ("party", 21, 4),
    ("stalled", 25, 4), ("pressure", 29, 4),
  ]

  public static func checkTrace(_ fixture: TraceFixture, _ manifest: Manifest) -> TraceResult {
    let runner = Runner(manifest: manifest)
    if runner.agents.count != fixture.agentCount {
      return TraceResult(name: fixture.name, ticks: fixture.checksums.count, matchedTo: 0,
                         detail: "built \(runner.agents.count) agents, fixture has \(fixture.agentCount)")
    }

    var buffer = [UInt8](repeating: 0, count: fixture.agentCount * TraceFixture.recordBytes)
    let checkpoints = Dictionary(uniqueKeysWithValues: fixture.checkpoints.map { ($0.tick, $0) })

    for t in 0..<fixture.checksums.count {
      runner.step()
      let n = packTick(runner.agents, into: &buffer)
      if fnv1a64(buffer, n) == fixture.checksums[t] { continue }

      // Localised to the tick. If this one is a checkpoint there is real state
      // to diff against; otherwise name the nearest earlier one, and point at
      // `--full` for field detail at an arbitrary tick.
      var detail = "diverged at tick \(t) of \(fixture.checksums.count)"
      if let cp = checkpoints[t] {
        let want = [UInt8](cp.bytes)
        var found = false
        for b in 0..<Swift.min(n, want.count) where buffer[b] != want[b] {
          let agent = b / TraceFixture.recordBytes
          let off = b % TraceFixture.recordBytes
          let field = fields.first { off >= $0.1 && off < $0.1 + $0.2 }?.0 ?? "?"
          detail += "\n         first difference: agent \(agent), field \(field)"
          found = true
          break
        }
        if !found { detail += " (checkpoint bytes agree — the checksum covers more agents)" }
      } else {
        let last = (t / fixture.checkpointEvery) * fixture.checkpointEvery
        detail += "\n         nearest checkpoint below: tick \(last)"
        detail += "\n         for field detail here: npx vite-node tools/goldenTrace.ts --full \(fixture.name)"
      }
      return TraceResult(name: fixture.name, ticks: fixture.checksums.count,
                         matchedTo: t, detail: detail)
    }

    return TraceResult(name: fixture.name, ticks: fixture.checksums.count,
                       matchedTo: fixture.checksums.count, detail: nil)
  }
}
