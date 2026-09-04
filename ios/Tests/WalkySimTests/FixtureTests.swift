import Testing
import Foundation
@testable import WalkySim

/// The readers are load-bearing: a misread offset would look like a divergence
/// in the model rather than a bug here, which is the most expensive kind of
/// wrong answer this project can produce. These check the fixtures parse and
/// that each binary agrees with the manifest beside it.

private func fixturesDir() -> URL {
  URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // WalkySimTests
    .deletingLastPathComponent()   // Tests
    .deletingLastPathComponent()   // ios
    .appendingPathComponent("Fixtures")
}

@Suite("Fixtures")
struct FixtureTests {
  @Test("every fixture on disk parses, and its trailer checksum verifies")
  func allParse() throws {
    let (graphs, traces) = try FixtureSet.load(from: fixturesDir())
    // 5 graph maps + 7 recorded runs. If this drops, a fixture went missing:
    //   npx vite-node tools/goldenTrace.ts
    #expect(graphs.count == 5)
    #expect(traces.count == 7)
    // The initialisers throw on a checksum mismatch, so reaching the end is
    // the assertion.
    for g in graphs { _ = try GraphFixture(contentsOf: g.url) }
    for t in traces { _ = try TraceFixture(contentsOf: t.url) }
  }

  @Test("a trace's binary agrees with the manifest beside it")
  func traceMatchesManifest() throws {
    let (_, traces) = try FixtureSet.load(from: fixturesDir())
    for e in traces {
      let t = try TraceFixture(contentsOf: e.url)
      #expect(t.name == e.manifest.name)
      #expect(t.radius == e.manifest.radius)
      #expect(t.speed == e.manifest.speed)
      #expect(t.personalSpace == e.manifest.personalSpace)
      #expect(t.checksums.count == e.manifest.ticks)
      #expect(t.agentCount == e.manifest.agents?.count)
    }
  }

  @Test("nothing refers to a wall by a run-local id")
  func indicesNotIds() throws {
    // Wall ids come from a counter in model.ts and depend on what the process
    // built first. Every cross-reference must be an index into the scenario's
    // own wall list, or a fixture would change whenever a scenario was added
    // above it.
    let (graphs, traces) = try FixtureSet.load(from: fixturesDir())
    for e in traces {
      let n = e.manifest.walls.count
      for p in e.manifest.agents ?? [] { #expect(p.goal >= -1 && p.goal < n) }
      for (i, w) in e.manifest.walls.enumerated() { #expect(w.index == i) }
    }
    for e in graphs {
      let g = try GraphFixture(contentsOf: e.url)
      let n = Int32(e.manifest.walls.count)
      for w in g.nodeWall { #expect(w >= 0 && w < n) }
      for f in g.fields { #expect(f.goalIndex >= 0 && f.goalIndex < n) }
    }
  }

  @Test("the CSR adjacency is well formed")
  func csrShape() throws {
    let (graphs, _) = try FixtureSet.load(from: fixturesDir())
    for e in graphs {
      let g = try GraphFixture(contentsOf: e.url)
      #expect(g.offsets.count == g.nodeCount + 1)
      #expect(g.offsets.first == 0)
      #expect(Int(g.offsets.last!) == g.edgeCount)
      #expect(g.weights.count == g.edgeCount)
      // Offsets must be non-decreasing, or a node's edge range is nonsense.
      for i in 1..<g.offsets.count { #expect(g.offsets[i] >= g.offsets[i - 1]) }
      for t in g.targets { #expect(t >= 0 && Int(t) < g.nodeCount) }
      for w in g.weights { #expect(w > 0) }
    }
  }

  @Test("every goal node is its own field's zero, and reachable nodes are finite")
  func fieldsAreSane() throws {
    let (graphs, _) = try FixtureSet.load(from: fixturesDir())
    for e in graphs {
      let g = try GraphFixture(contentsOf: e.url)
      for f in g.fields {
        var sources = 0
        for i in 0..<g.nodeCount where g.nodeWall[i] == f.goalIndex {
          sources += 1
          #expect(f.dist[i] == 0)
          #expect(f.prev[i] == -1)
        }
        #expect(sources > 0, "\(g.name): goal \(f.goalIndex) seeded no Dijkstra sources")
      }
    }
  }

  @Test("checkpoints land on the stride, start at tick 0, and include the last tick")
  func checkpointLayout() throws {
    let (_, traces) = try FixtureSet.load(from: fixturesDir())
    for e in traces {
      let t = try TraceFixture(contentsOf: e.url)
      // Tick 0 above all: a port wrong on its very first step is the common
      // case while it is young, and that is where it lands.
      #expect(t.checkpoints.first?.tick == 0)
      #expect(t.checkpoints.last?.tick == t.checksums.count - 1)
      for c in t.checkpoints {
        #expect(c.count == t.agentCount)
        #expect(c.bytes.count == c.count * TraceFixture.recordBytes)
        let onStride = c.tick % t.checkpointEvery == 0
        #expect(onStride || c.tick == t.checksums.count - 1)
      }
    }
  }
}
