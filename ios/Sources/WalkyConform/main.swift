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

default:
  FileHandle.standardError.write(Data("usage: walky-conform [math]\n".utf8))
  exit(2)
}

extension String {
  func leftPad(_ n: Int) -> String {
    count >= n ? self : String(repeating: " ", count: n - count) + self
  }
}
