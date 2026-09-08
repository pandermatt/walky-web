import Foundation

/// The domain types the simulation needs. Ports the load-bearing part of
/// `src/state/model.ts`; the settings, labels and generators follow later.
public typealias RGB = (r: Int, g: Int, b: Int)

/// What makes a wall a door: a schedule, a queue, and somewhere to send people.
///
/// Ports `Generator` in `src/state/model.ts`, but as a payload on `Wall` rather
/// than a type of its own beside it. A door **is** a wall in this port: it
/// blocks the crowd like any other, and people come out of it rather than
/// through it, which is what a building with a door in it actually does. The web
/// app keeps generators as separate objects and is not being changed.
///
/// Nil on an ordinary wall, so a wall either is a door or is not -- one
/// optional saying it once, rather than a flag plus three numbers that mean
/// nothing while it is false.
///
/// The arithmetic behind the schedule is already here and has been since the
/// port: see `Arrivals.swift`, which turns a door's position and its beat into a
/// clump size and a gap.
public final class Door {
  /// Pedestrians per second, as the slider stood when this one was placed.
  ///
  /// Kept per door rather than read from the settings when it fires, for the
  /// reason a label keeps its own size: a busy door and a quiet one on the same
  /// map is the whole point, and one number in the settings could only describe
  /// a map where every door is the same door.
  public var rate: Double
  /// Goal wall id, or -1 while it is not pinned anywhere.
  public var goal: Int
  /// The queue behind the door: people who have arrived and not yet got through.
  ///
  /// A clump lands in here whole and leaves at whatever rate the doorway can
  /// pass, which is what makes a burst look like a burst rather than like ten
  /// people appearing at once in a space that holds three.
  public var owed: Double
  /// Which clump is next, indexing this door's own schedule. See `Arrivals`.
  public var beat: Double
  /// Ticks left before that clump arrives.
  public var wait: Double

  public init(rate: Double, goal: Int = -1,
              owed: Double = 0, beat: Double = 0, wait: Double = 0) {
    self.rate = rate
    self.goal = goal
    self.owed = owed
    self.beat = beat
    self.wait = wait
  }

  /// As `Wall.shallowCopy`, and for the same reason: a checkpoint that stored
  /// the object would alias the live one and undo nothing. The queue and the
  /// beat are part of what undo puts back.
  public func copy() -> Door {
    Door(rate: rate, goal: goal, owed: owed, beat: beat, wait: wait)
  }
}

/// How many pedestrians across a generator's footprint is.
///
/// Three, at the brush's own pitch, which is the smallest block that still
/// gives somebody a way out when the middle of it is occupied -- and the
/// largest that still reads as a door rather than as a room.
public let GENERATOR_CELLS = 3

/// The square a hand-placed door occupies, in world units.
///
/// Derived from the pedestrian radius rather than stored, so it is the size of
/// the people coming out of it at whatever the radius slider says -- the same
/// bargain the brush block makes. Placement, the preview and the wall it
/// becomes all call this, so all three agree by construction.
///
/// A door is a wall now, so this footprint is solid: people come out *beside*
/// it, on the side its goal is on, rather than standing in it. What tells it
/// from an ordinary wall is not its size but how it is drawn -- dashed and
/// unfilled, where a wall is filled -- and, on a scanned map, that a real wall
/// is `WALL_THICKNESS` thick where a doorway is a thin slab. Two cues, neither
/// of them colour.
public func generatorSquare(_ at: Point, _ radius: Double) -> [Point] {
  let half = Double(GENERATOR_CELLS) * radius
  return rectanglePolygon(Point(at.x - half, at.y - half),
                          Point(at.x + half, at.y + half))
}

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
  /// graph reads, and shipping it would invite somebody to trust it. Nor is the
  /// door: it is a schedule and a queue, and the graph asks only about shape.
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
  /// Nil on an ordinary wall. Non-nil makes this a door: still a wall, still
  /// blocking, but with people coming out of it. See `Door`.
  public var door: Door?

  public init(id: Int, polygons: [[Point]], color: RGB = (150, 150, 150),
              isGoal: Bool = false, isBorder: Bool = false, door: Door? = nil) {
    self.id = id
    self.polygons = polygons
    self.hull = monotoneChainHull(polygons.flatMap { $0 })
    self.color = color
    self.isGoal = isGoal
    self.isBorder = isBorder
    self.selected = false
    self.door = door
  }

  /// Takes the hull rather than computing it. Only for `shallowCopy`, where the
  /// hull is known to be current: recomputing would run `monotoneChainHull` per
  /// wall per checkpoint, forty checkpoints deep, for a value that cannot have
  /// changed.
  public init(id: Int, polygons: [[Point]], hull: [Point], color: RGB,
              isGoal: Bool, isBorder: Bool, selected: Bool, door: Door? = nil) {
    self.id = id
    self.polygons = polygons
    self.hull = hull
    self.color = color
    self.isGoal = isGoal
    self.isBorder = isBorder
    self.selected = selected
    self.door = door
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
  /// The door is copied rather than shared, because its queue and its beat are
  /// state a map edit writes -- and so state undo has to put back.
  public func shallowCopy() -> Wall {
    Wall(id: id, polygons: polygons, hull: hull, color: color,
         isGoal: isGoal, isBorder: isBorder, selected: selected, door: door?.copy())
  }
}

/// An axis-aligned rectangle as a closed ring, wound as `model.ts` winds it.
public func rectanglePolygon(_ a: Point, _ b: Point) -> [Point] {
  let left = jsMin(a.x, b.x), right = jsMax(a.x, b.x)
  let top = jsMin(a.y, b.y), bottom = jsMax(a.y, b.y)
  return [Point(left, top), Point(right, top), Point(right, bottom), Point(left, bottom)]
}
