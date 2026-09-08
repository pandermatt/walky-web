import Testing
import Foundation
import WalkySim
@testable import WalkyGeo

/// An axis-aligned rectangle, wound the way OpenStreetMap winds a building.
private func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> [Point] {
  [Point(x, y), Point(x + w, y), Point(x + w, y + h), Point(x, y + h)]
}

private func area(_ ring: [Point]) -> Double { abs(signedArea2(ring)) / 2 }

/// Fewer shapes for the same buildings.
///
/// The cases here are the ones the design turns on, not a sweep: OpenStreetMap
/// draws a `building` and its `building:part` twice, draws a terrace as
/// neighbours sharing a wall, and draws a city block as four buildings round a
/// courtyard. The first two should collapse and the third must not.
@Suite("Merging footprints")
struct MergeTests {
  @Test("a ring drawn inside another is a building:part, and goes")
  func dropsContained() {
    let outline = rect(0, 0, 100, 100)
    let part = rect(20, 20, 30, 30)
    let merged = mergeFootprints([outline, part])
    #expect(merged.count == 1)
    #expect(merged[0] == outline)
  }

  @Test("two buildings sharing a wall become one, and lose corners")
  func terraceCollapses() {
    // Neighbours, touching along x = 50. Their hull is the enclosing rectangle,
    // which is exactly their union, so it is as tight as a hull can be.
    let left = rect(0, 0, 50, 40)
    let right = rect(50, 0, 50, 40)
    let merged = mergeFootprints([left, right])
    #expect(merged.count == 1)
    #expect(ImportBudget.vertices(merged) < ImportBudget.vertices([left, right]))
    #expect(abs(area(merged[0]) - 4000) < 1e-6)
  }

  /// The test the whole design exists for.
  @Test("four buildings round a courtyard are left alone")
  func courtyardSurvives() {
    // A ring of four bars enclosing an empty middle. Every pair touches, so
    // they are one cluster; their hull is the solid 100x100 block, two and a
    // half times the area of the bars themselves.
    let ring = [
      rect(0, 0, 100, 20), rect(0, 80, 100, 20),
      rect(0, 20, 20, 60), rect(80, 20, 20, 60),
    ]
    let merged = mergeFootprints(ring)
    #expect(merged.count == 4)
    // Not merely four shapes -- the same four, so the courtyard is still there.
    let covered = merged.reduce(0.0) { $0 + area($1) }
    #expect(abs(covered - ring.reduce(0.0) { $0 + area($1) }) < 1e-6)
  }

  @Test("buildings that touch nothing come back unchanged, in order")
  func lonersUntouched() {
    let a = rect(0, 0, 10, 10)
    let b = rect(500, 0, 10, 10)
    let c = rect(0, 500, 10, 10)
    #expect(mergeFootprints([a, b, c]) == [a, b, c])
  }

  @Test("merging never adds a corner")
  func neverGrows() {
    // A spread of arrangements: overlapping, touching, nested and apart.
    var cases: [[[Point]]] = []
    for dx in stride(from: 0.0, through: 60.0, by: 12) {
      for dy in stride(from: 0.0, through: 60.0, by: 12) {
        cases.append([rect(0, 0, 50, 50), rect(dx, dy, 30, 30), rect(200, 200, 40, 10)])
      }
    }
    for polygons in cases {
      let merged = mergeFootprints(polygons)
      #expect(ImportBudget.vertices(merged) <= ImportBudget.vertices(polygons))
    }
  }

  @Test("a merged cluster leaves none of its members behind")
  func noDuplicates() {
    let left = rect(0, 0, 50, 40)
    let right = rect(50, 0, 50, 40)
    let far = rect(400, 400, 10, 10)
    let merged = mergeFootprints([left, right, far])
    #expect(!merged.contains(left))
    #expect(!merged.contains(right))
    #expect(merged.contains(far))
  }

  // MARK: - Simplification, which ordinary buildings must not see

  @Test("a four-corner house is returned vertex for vertex")
  func housesAreUntouched() {
    // The guard on SIMPLIFY_ABOVE, and the one that fails first if the
    // threshold is ever lowered to where a surveyed building reaches it.
    let house = rect(0, 0, 12, 9)
    #expect(mergeFootprints([house], simplifyTolerance: 6) == [house])
  }

  @Test("a traced curve loses vertices but keeps its shape")
  func curvesSimplify() {
    // A hundred-node arc, the way a church apse or a stadium arrives.
    var ring: [Point] = []
    for i in 0..<100 {
      let t = Double(i) / 100 * 2 * Double.pi
      ring.append(Point(500 * cos(t), 500 * sin(t)))
    }
    let merged = mergeFootprints([ring], simplifyTolerance: 6)
    #expect(merged.count == 1)
    #expect(merged[0].count < ring.count)
    // Within a couple of percent of the circle it stood for.
    #expect(abs(area(merged[0]) - area(ring)) / area(ring) < 0.02)
  }

  @Test("simplification cannot close a gap a pedestrian fits through")
  func gapsSurvive() {
    // A C-shape with a mouth one pedestrian diameter wide, drawn with enough
    // corners to pass SIMPLIFY_ABOVE. At half a radius of tolerance the mouth
    // is many times the tolerance, so it cannot be smoothed shut.
    let gap = 26.0
    var ring: [Point] = [Point(0, 0), Point(200, 0), Point(200, 100), Point(0, 100)]
    ring.insert(contentsOf: (1...10).map { Point(Double($0) * 18, 100 - gap) }, at: 3)
    let merged = mergeFootprints([ring], simplifyTolerance: 6.5)
    #expect(merged.count == 1)
    // The notch's depth survives: the shape is still not a plain rectangle.
    #expect(area(merged[0]) < 200 * 100 * 0.98)
  }
}
