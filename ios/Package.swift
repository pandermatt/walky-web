// swift-tools-version: 6.0
import PackageDescription

// The simulation is a standalone package on purpose. It has no UIKit, no Metal
// and no Foundation-UI, so it builds and its conformance runner *runs* under
// plain SwiftPM -- which is what lets the risky part of the port be verified
// without Xcode, a simulator, or a device.
let package = Package(
  name: "WalkySim",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [
    .library(name: "WalkySim", targets: ["WalkySim"]),
    .executable(name: "walky-conform", targets: ["WalkyConform"]),
  ],
  targets: [
    // fdlibm, as V8 uses it. See Sources/CWalkyMath/README for why this exists.
    .target(name: "CWalkyMath"),
    .target(name: "WalkySim", dependencies: ["CWalkyMath"]),
    .executableTarget(name: "WalkyConform", dependencies: ["WalkySim"]),
    .testTarget(name: "WalkySimTests", dependencies: ["WalkySim"]),
  ]
)
