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

    // A full-size import, and **nothing sets the ceiling by hand**. That line
    // used to be here, which is why the app could not frame an import while
    // this test was green: `resetZoom` is the thing under test, not the setup.
    let side = 380.0
    world.geoAnchor = GeoAnchor(origin: Coordinate(latitude: 47.4963, longitude: 8.7297))
    world.addWalls(footprints(side, 7))
    world.resetZoom()

    let bounds = world.contentBounds()!
    let across = bounds.maxX - bounds.minX
    let onScreen = across * world.viewport.scale
    #expect(onScreen <= 402, "import is \(onScreen)pt wide on a 402pt screen")
  }

  /// The floor. A map that fits at the original's stops must still use them, or
  /// the 2016 camera would quietly become a different camera on every map.
  @Test("a drawn map keeps the original's zoom stops")
  func drawnMapUnchanged() {
    let world = WalkyWorld()
    world.viewport.width = 402
    world.viewport.height = 874
    world.addWalls([[rectanglePolygon(Point(0, 0), Point(200, 200))]])
    world.resetZoom()
    #expect(world.viewport.zoomLevelMax == ZOOM_LEVEL_MAX)
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
