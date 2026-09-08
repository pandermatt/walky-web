import Foundation

/// The domain types the simulation needs. Ports the load-bearing part of
/// `src/state/model.ts`; the settings, labels and generators follow later.
public typealias RGB = (r: Int, g: Int, b: Int)

/// A wall flattened into something that can cross a thread.
///
/// `Wall` is a class, so an array of them cannot be handed to a background
/// build. This carries exactly what `buildVisibilityGraph` reads and nothing
/// else -- notably it carries the **hull**, so the build reconstructs walls
/// through `Wall.init(id:polygons:hull:...)` rather than recomputing
/// `monotoneChainHull` per wall. That saves the work twice over: the hull is
/// already known, and reusing it guarantees the background build sees byte
/// identical input to what the main actor holds, so the graph cannot differ.
public struct WallSnapshot: Sendable {
  public var id: Int
  public var polygons: [[Point]]
  public var hull: [Point]
  public var color: RGB
  public var isGoal: Bool
  public var isBorder: Bool

  public init(_ wall: Wall) {
    id = wall.id
    polygons = wall.polygons
    hull = wall.hull
    color = wall.color
    isGoal = wall.isGoal
    isBorder = wall.isBorder
  }

  /// `selected` is not carried: it is a pointer-tool state that no part of the
  /// graph reads, and shipping it would invite somebody to trust it.
  public var wall: Wall {
    Wall(id: id, polygons: polygons, hull: hull, color: color,
         isGoal: isGoal, isBorder: isBorder, selected: false)
  }
}

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

  /// Takes the hull rather than computing it. Only for `shallowCopy`, where the
  /// hull is known to be current: recomputing would run `monotoneChainHull` per
  /// wall per checkpoint, forty checkpoints deep, for a value that cannot have
  /// changed.
  public init(id: Int, polygons: [[Point]], hull: [Point], color: RGB,
              isGoal: Bool, isBorder: Bool, selected: Bool) {
    self.id = id
    self.polygons = polygons
    self.hull = hull
    self.color = color
    self.isGoal = isGoal
    self.isBorder = isBorder
    self.selected = selected
  }

  /// The one-level clone an undo snapshot takes, matching `{...w}` at
  /// app.ts:1214.
  ///
  /// This method has to exist, and its absence would be silent. In JS the
  /// spread makes a genuine new object per wall; `Wall` here is a class, so
  /// `walls.map { $0 }` copies *nothing* -- the snapshot would hold the same
  /// objects, `hit.isGoal = true` would be visible through it, and undo would
  /// appear to work while doing nothing at all.
  ///
  /// Copied: the flags a map edit writes in place. Shared: the geometry, which
  /// is never mutated in place. Sharing is free and, unlike in JS, safe --
  /// `[[Point]]` is copy-on-write, so a write anybody did make would fork the
  /// buffer rather than reach through.
  public func shallowCopy() -> Wall {
    Wall(id: id, polygons: polygons, hull: hull, color: color,
         isGoal: isGoal, isBorder: isBorder, selected: selected)
  }
}

/// An axis-aligned rectangle as a closed ring, wound as `model.ts` winds it.
public func rectanglePolygon(_ a: Point, _ b: Point) -> [Point] {
  let left = jsMin(a.x, b.x), right = jsMax(a.x, b.x)
  let top = jsMin(a.y, b.y), bottom = jsMax(a.y, b.y)
  return [Point(left, top), Point(right, top), Point(right, bottom), Point(left, bottom)]
}
