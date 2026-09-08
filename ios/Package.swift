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
    .library(name: "WalkyCore", targets: ["WalkyCore"]),
    .library(name: "WalkyGeo", targets: ["WalkyGeo"]),
    .executable(name: "walky-conform", targets: ["WalkyConform"]),
    .executable(name: "walky-icons", targets: ["WalkyIcons"]),
    // What a real neighbourhood costs the navigation rebuild. Written to
    // decide whether this feature was possible at all, kept because the answer
    // is a number the import limit is set from and will have to be re-measured
    // when the visibility sweep changes.
    .executable(name: "walky-geobench", targets: ["WalkyGeoBench"]),
  ],
  targets: [
    // fdlibm, as V8 uses it. See Sources/CWalkyMath/README for why this exists.
    .target(name: "CWalkyMath"),
    .target(name: "WalkySim", dependencies: ["CWalkyMath"]),
    // Everything the app needs that is logic rather than pixels: the camera,
    // the tools, the pointer state machine, the world's edits and undo.
    //
    // A library rather than app-target sources for the same reason WalkySim is
    // one: there is no simulator runtime on this machine, so anything that
    // lives only in the Xcode target is code that can be compiled and never
    // run. This keeps the intricate half of the app under `swift test` and
    // leaves the untestable surface as genuinely just pixels.
    .target(name: "WalkyCore", dependencies: ["WalkySim", "WalkyGeo"]),
    // OpenStreetMap footprints as walls, and the projection that places them.
    // Depends on WalkySim alone and carries no framework, so the arithmetic
    // that decides where a building lands is checkable without a simulator.
    .target(name: "WalkyGeo", dependencies: ["WalkySim"]),
    .executableTarget(name: "WalkyConform", dependencies: ["WalkySim"]),
    // Renders the alternate app icons. It depends on WalkyCore so the icon
    // colours *are* the theme's colours rather than a second copy of them --
    // see Sources/WalkyCore/AppIcons.swift.
    .executableTarget(name: "WalkyIcons", dependencies: ["WalkyCore"]),
    .executableTarget(name: "WalkyGeoBench", dependencies: ["WalkyCore", "WalkyGeo"]),
    .testTarget(name: "WalkySimTests", dependencies: ["WalkySim"]),
    .testTarget(name: "WalkyCoreTests", dependencies: ["WalkyCore"]),
    .testTarget(name: "WalkyGeoTests", dependencies: ["WalkyGeo"]),
  ]
)
