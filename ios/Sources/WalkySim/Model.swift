import Foundation

/// The domain types the simulation needs. Ports the load-bearing part of
/// `src/state/model.ts`; the settings, labels and generators follow later.
public typealias RGB = (r: Int, g: Int, b: Int)

public final class Wall {
  public var id: Int
  /// One shape may be several polygons: a border frame is four bars.
  public var polygons: [[Point]]
  public var hull: [Point]
  public var color: RGB
  public var isGoal: Bool
  public var isBorder: Bool
  public var selected: Bool

  public init(id: Int, polygons: [[Point]], color: RGB = (150, 150, 150),
              isGoal: Bool = false, isBorder: Bool = false) {
    self.id = id
    self.polygons = polygons
    self.hull = monotoneChainHull(polygons.flatMap { $0 })
    self.color = color
    self.isGoal = isGoal
    self.isBorder = isBorder
    self.selected = false
  }
}

/// An axis-aligned rectangle as a closed ring, wound as `model.ts` winds it.
public func rectanglePolygon(_ a: Point, _ b: Point) -> [Point] {
  let left = jsMin(a.x, b.x), right = jsMax(a.x, b.x)
  let top = jsMin(a.y, b.y), bottom = jsMax(a.y, b.y)
  return [Point(left, top), Point(right, top), Point(right, bottom), Point(left, bottom)]
}
