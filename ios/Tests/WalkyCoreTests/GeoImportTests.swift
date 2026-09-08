import Testing
import Foundation
import WalkySim
import WalkyGeo
@testable import WalkyCore

/// An import is a much bigger world than a drawn one, and the camera has to be
/// able to show it. 180m at 56px to the metre is 10,080px across.
@MainActor
@Suite("Importing a real place")
struct GeoImportTests {
  /// A grid of small buildings across `side` metres, as an import produces.
  private func footprints(_ side: Double, _ perRow: Int) -> [[[Point]]] {
    let across = side * PX_PER_METRE
    let step = across / Double(perRow)
    let size = step * 0.5
    var out: [[[Point]]] = []
    for row in 0..<perRow {
      for col in 0..<perRow {
        let x = Double(col) * step, y = Double(row) * step
        out.append([[Point(x, y), Point(x + size, y),
                     Point(x + size, y + size), Point(x, y + size)]])
      }
    }
    return out
  }

  @Test("one edit, one undo step, however many buildings")
  func bulkIsOneEdit() {
    let world = WalkyWorld()
    #expect(world.addWalls(footprints(180, 7)) == 49)
    #expect(world.walls.count == 49)
    world.undo()
    #expect(world.walls.isEmpty)          // one undo, not 49
  }

  @Test("the camera can show the whole import")
  func fitsTheImport() {
    let world = WalkyWorld()
    world.viewport.width = 402           // iPhone 17 Pro, in points
    world.viewport.height = 874

    let side = 180.0
    world.geoAnchor = GeoAnchor(origin: Coordinate(latitude: 47.4963, longitude: 8.7297))
    world.viewport.zoomLevelMax = log(side * PX_PER_METRE / 320) / log(ZOOM_FACTOR) + 6
    world.addWalls(footprints(side, 7))
    world.resetZoom()

    let bounds = world.contentBounds()!
    let across = bounds.maxX - bounds.minX
    let onScreen = across * world.viewport.scale
    #expect(onScreen <= 402, "import is \(onScreen)pt wide on a 402pt screen")
  }

  @Test("clearing puts the original's stops back")
  func clearingResets() {
    let world = WalkyWorld()
    world.geoAnchor = GeoAnchor(origin: Coordinate(latitude: 47.5, longitude: 8.7))
    world.viewport.zoomLevelMax = 46
    world.clearAll()
    #expect(world.geoAnchor == nil)
    #expect(world.viewport.zoomLevelMax == ZOOM_LEVEL_MAX)
  }
}
