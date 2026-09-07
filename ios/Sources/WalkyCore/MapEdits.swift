import Foundation

/// The map edits a tool can make. Ports the rest of `src/state/model.ts`.

public struct WallOptions {
  public var color: RGB?
  /// True only for a border frame; see `Wall.isBorder`.
  public var isBorder: Bool
  public init(color: RGB? = nil, isBorder: Bool = false) {
    self.color = color
    self.isBorder = isBorder
  }
}

/// Ids come from one counter, as `model.ts` does it. Not serialized and not
/// stable across launches -- which is exactly why the golden fixtures refer to
/// walls by index and never by id.
public enum WallIds {
  @MainActor private static var next = 1
  @MainActor public static func mint() -> Int {
    defer { next += 1 }
    return next
  }
}

@MainActor
public func makeWall(_ polygons: [[Point]], _ options: WallOptions = WallOptions()) -> Wall {
  Wall(id: WallIds.mint(), polygons: polygons,
       color: options.color ?? randomBrightColor(),
       isGoal: false, isBorder: options.isBorder)
}

/// The four bars of a border frame, overlapping at the corners.
///
/// Ports `BorderToolMouseListener.addBorderFrom`. Extending every bar past the
/// corner by the thickness is what seals the frame: bars that merely met at a
/// shared corner point could leave a diagonal gap for a pedestrian to slip
/// through, which is exactly the failure an enclosure must not have.
public func borderFrame(_ a: Point, _ b: Point, _ thickness: Double) -> [[Point]] {
  let t = jsMax(1, thickness)
  let left = jsMin(a.x, b.x), right = jsMax(a.x, b.x)
  let top = jsMin(a.y, b.y), bottom = jsMax(a.y, b.y)
  return [
    rectanglePolygon(Point(left - t, top - t), Point(right + t, top + t)),
    rectanglePolygon(Point(left - t, bottom - t), Point(right + t, bottom + t)),
    rectanglePolygon(Point(left - t, top - t), Point(left + t, bottom + t)),
    rectanglePolygon(Point(right - t, top - t), Point(right + t, bottom + t)),
  ]
}

/// Whether a frame would leave usable space inside.
///
/// Navigation pushes each bar out by the pedestrian radius, so the interior a
/// pedestrian's centre can occupy shrinks by thickness + radius on every side.
/// Below that the box is sealed solid, and drawing one would look like it
/// worked while being unusable.
public func borderFits(_ a: Point, _ b: Point, _ thickness: Double, _ radius: Double) -> Bool {
  let margin = 2 * (jsMax(1, thickness) + radius)
  return abs(b.x - a.x) > margin + 2 * radius
      && abs(b.y - a.y) > margin + 2 * radius
}

public func wallContains(_ wall: Wall, _ p: Point) -> Bool {
  wall.polygons.contains { pointInPolygon($0, p) }
}

/// Ports `Wall.intersectsWall`: shared area or crossing edges.
public func polygonsOverlap(_ a: [Point], _ b: [Point]) -> Bool {
  if a.contains(where: { pointInPolygon(b, $0) }) { return true }
  if b.contains(where: { pointInPolygon(a, $0) }) { return true }
  for i in 0..<a.count {
    let a1 = a[i]
    let a2 = a[(i + 1) % a.count]
    for j in 0..<b.count where segmentsCross(a1, a2, b[j], b[(j + 1) % b.count]) {
      return true
    }
  }
  return false
}

public func wallOverlapsPolygon(_ wall: Wall, _ poly: [Point]) -> Bool {
  wall.polygons.contains { polygonsOverlap($0, poly) }
}

/// Whether two walls share any area or crossing edge.
public func wallsOverlap(_ a: Wall, _ b: Wall) -> Bool {
  a.polygons.contains { wallOverlapsPolygon(b, $0) }
}
