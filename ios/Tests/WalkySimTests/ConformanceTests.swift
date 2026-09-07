import Testing
import Foundation
@testable import WalkySim

/// The port against V8, as part of the ordinary test run.
///
/// `swift run walky-conform` is the tool for chasing a divergence -- it names
/// the tick, the agent and the field. These are the gate: they say only whether
/// the two implementations still agree.

private func fixturesDir() -> URL {
  URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Fixtures")
}

@Suite("Conformance with V8")
struct ConformanceTests {
  @Test("fdlibm matches V8 on every probed function")
  func math() throws {
    let probe = try MathProbe(contentsOf: fixturesDir().appendingPathComponent("math.wkmp"))
    for r in probe.run() {
      #expect(!r.guardFailed, "\(r.name): the Swift sampler disagrees with tools/mathProbe.ts")
      #expect(r.mismatches == 0, "\(r.name): \(r.mismatches) of \(r.samples) differ")
    }
  }

  @Test("the visibility graph and its routing fields match V8")
  func graphs() throws {
    let (graphs, _) = try FixtureSet.load(from: fixturesDir())
    for e in graphs {
      let r = Conformance.checkGraph(try GraphFixture(contentsOf: e.url), e.manifest)
      #expect(r.ok, "\(r.name): \(r.mismatches.map(\.what).joined(separator: ", "))")
    }
  }

  @Test("every recorded run replays tick for tick", .timeLimit(.minutes(5)))
  func traces() throws {
    let (_, traces) = try FixtureSet.load(from: fixturesDir())
    for e in traces {
      let r = Conformance.checkTrace(try TraceFixture(contentsOf: e.url), e.manifest)
      #expect(r.ok, "\(r.name): \(r.detail ?? "")")
    }
  }
}
