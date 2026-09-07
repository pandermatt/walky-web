import Foundation
import WalkySim

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? "math"

/// Fixtures sit beside the package, not inside a bundle: this runs under plain
/// SwiftPM, where there is no bundle to look in.
func fixtures() -> URL {
  URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // WalkyConform
    .deletingLastPathComponent()   // Sources
    .deletingLastPathComponent()   // ios
    .appendingPathComponent("Fixtures")
}

switch command {
case "math":
  let url = fixtures().appendingPathComponent("math.wkmp")
  guard let probe = try? MathProbe(contentsOf: url) else {
    FileHandle.standardError.write(Data("no probe at \(url.path)\n  regenerate: npx vite-node tools/mathProbe.ts\n".utf8))
    exit(2)
  }
  let results = probe.run()
  print("fdlibm vs V8 — \(url.lastPathComponent)\n")
  print("  \("function".padding(toLength: 12, withPad: " ", startingAt: 0))\("samples".leftPad(9))\("differ".leftPad(9))   verdict")
  var failed = false
  for r in results {
    let verdict: String
    if r.guardFailed {
      verdict = "GENERATOR MISMATCH — the Swift sampler disagrees with tools/mathProbe.ts"
      failed = true
    } else if r.mismatches == 0 {
      verdict = "identical"
    } else {
      let pct = 100.0 * Double(r.mismatches) / Double(r.samples)
      verdict = String(format: "DIVERGES %.3f%%", pct)
      failed = true
    }
    print("  \(r.name.padding(toLength: 12, withPad: " ", startingAt: 0))\(String(r.samples).leftPad(9))\(String(r.mismatches).leftPad(9))   \(verdict)")
    if let b = r.firstBad {
      print("       first: f(\(b.a), \(b.b))")
      print("              got  \(b.got)  0x\(String(b.got.bitPattern, radix: 16))")
      print("              want \(b.want)  0x\(String(b.want.bitPattern, radix: 16))")
    }
  }
  print("")
  if failed {
    print("Not bit-identical. The simulation port cannot start until it is.")
    exit(1)
  }
  print("All \(results.count) functions bit-identical to V8 over \(results.first?.samples ?? 0) samples each.")

case "list":
  do {
    let (graphs, traces) = try FixtureSet.load(from: fixtures())

    print("graph fixtures — geometry only, nothing steps")
    for e in graphs {
      let g = try GraphFixture(contentsOf: e.url)
      let goals = e.manifest.walls.filter(\.isGoal).count
      print("  \(g.name.padding(toLength: 16, withPad: " ", startingAt: 0))"
            + "\(String(g.nodeCount).leftPad(4)) nodes  \(String(g.edgeCount).leftPad(6)) edges  "
            + "\(g.fields.count) field(s)  \(e.manifest.walls.count) walls, \(goals) goal(s)")
      print("       \(e.manifest.proves)")
    }

    print("\ntrace fixtures — one checksum per tick, full records at checkpoints")
    for e in traces {
      let t = try TraceFixture(contentsOf: e.url)
      print("  \(t.name.padding(toLength: 16, withPad: " ", startingAt: 0))"
            + "\(String(t.agentCount).leftPad(4)) agents  \(String(t.checksums.count).leftPad(4)) ticks  "
            + "\(String(t.checkpoints.count).leftPad(3)) checkpoints  "
            + "r=\(Int(t.radius)) v=\(t.speed) space=\(Int(t.personalSpace))")
      print("       \(e.manifest.proves)")
    }
    print("\n\(graphs.count + traces.count) fixtures read, every checksum verified.")
  } catch {
    FileHandle.standardError.write(Data("could not read fixtures: \(error)\n".utf8))
    exit(1)
  }

case "graph":
  do {
    let (graphs, _) = try FixtureSet.load(from: fixtures())
    print("visibility graph and routing fields vs V8\n")
    var failed = 0
    for e in graphs {
      let fixture = try GraphFixture(contentsOf: e.url)
      let r = Conformance.checkGraph(fixture, e.manifest)
      let head = "  \(r.name.padding(toLength: 16, withPad: " ", startingAt: 0))"
                 + "\(String(r.nodeCount).leftPad(4)) nodes  \(String(r.edgeCount).leftPad(6)) edges   "
      if r.ok {
        print(head + "identical")
      } else {
        failed += 1
        print(head + "DIVERGES")
        for m in r.mismatches {
          print("       \(m.what) [\(m.index)]")
          print("         got  \(m.got)")
          print("         want \(m.want)")
        }
      }
    }
    print("")
    if failed > 0 {
      print("\(failed) of \(graphs.count) graph fixtures diverge.")
      print("Geometry must be identical before behaviour.ts is worth porting: once a")
      print("crowd is walking, a graph bug and a behaviour bug look exactly alike.")
      exit(1)
    }
    print("All \(graphs.count) graph fixtures bit-identical to V8.")
  } catch {
    FileHandle.standardError.write(Data("could not check graphs: \(error)\n".utf8))
    exit(1)
  }

case "trace", "all":
  do {
    var failed = 0
    if command == "all" {
      let (graphs, _) = try FixtureSet.load(from: fixtures())
      print("visibility graph and routing fields vs V8\n")
      for e in graphs {
        let r = Conformance.checkGraph(try GraphFixture(contentsOf: e.url), e.manifest)
        print("  \(r.name.padding(toLength: 16, withPad: " ", startingAt: 0))"
              + (r.ok ? "identical" : "DIVERGES"))
        if !r.ok {
          failed += 1
          for m in r.mismatches {
            print("       \(m.what) [\(m.index)]")
            print("         got  \(m.got)")
            print("         want \(m.want)")
          }
        }
      }
      print("")
    }

    let (_, traces) = try FixtureSet.load(from: fixtures())
    print("recorded runs vs V8, tick by tick\n")
    for e in traces {
      let fixture = try TraceFixture(contentsOf: e.url)
      let r = Conformance.checkTrace(fixture, e.manifest)
      let head = "  \(r.name.padding(toLength: 16, withPad: " ", startingAt: 0))"
                 + "\(String(r.ticks).leftPad(4)) ticks   "
      if r.ok {
        print(head + "identical")
      } else {
        failed += 1
        print(head + "matched \(r.matchedTo) of \(r.ticks)")
        if let d = r.detail { print("       \(d)") }
      }
    }
    print("")
    if failed > 0 {
      print("\(failed) fixture(s) diverge.")
      exit(1)
    }
    print("Every fixture bit-identical to V8.")
  } catch {
    FileHandle.standardError.write(Data("could not check traces: \(error)\n".utf8))
    exit(1)
  }

default:
  FileHandle.standardError.write(Data("usage: walky-conform [math|list|graph|trace|all]\n".utf8))
  exit(2)
}

extension String {
  func leftPad(_ n: Int) -> String {
    count >= n ? self : String(repeating: " ", count: n - count) + self
  }
}
