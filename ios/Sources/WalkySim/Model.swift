import Foundation

/// The domain types the simulation needs. Ports the load-bearing part of
/// `src/state/model.ts`; the settings, labels and generators follow later.
public typealias RGB = (r: Int, g: Int, b: Int)

/// A door people come out of. Ports `Generator` in `src/state/model.ts`.
///
/// The arithmetic behind it is already here and has been since the port: see
/// `Arrivals.swift`, which turns a door's position and its beat into a clump
/// size and a gap. This is the thing that owns a schedule and a queue.
public final class Generator {
  public var id: Int
  /// Centre of the block; its extent is derived, see `generatorSquare`.
  public var at: Point
  /// Pedestrians per second, as the slider stood when this one was placed.
  ///
  /// Kept per generator rather than read from the settings when it fires, for
  /// the reason a label keeps its own size: a busy door and a quiet one on the
  /// same map is the whole point, and one number in the settings could only
  /// describe a map where every door is the same door.
  public var rate: Double
  /// Goal wall id, or -1 while it is not pinned anywhere.
  public var goal: Int
  /// Its goal's colour, as a pedestrian wears its goal's -- or white unpinned.
  public var color: RGB
  /// Unlike `Wall.selected`, this one is read: it is what the goal tool aims at.
  public var selected: Bool
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

  public init(id: Int, at: Point, rate: Double, goal: Int = -1,
              color: RGB = (255, 255, 255), selected: Bool = false,
              owed: Double = 0, beat: Double = 0, wait: Double = 0) {
    self.id = id
    self.at = at
    self.rate = rate
    self.goal = goal
    self.color = color
    self.selected = selected
    self.owed = owed
    self.beat = beat
    self.wait = wait
  }

  /// As `Wall.shallowCopy`, and for the same reason: an undo checkpoint that
  /// stored the objects would alias the live ones and undo nothing.
  public func shallowCopy() -> Generator {
    Generator(id: id, at: at, rate: rate, goal: goal, color: color,
              selected: selected, owed: owed, beat: beat, wait: wait)
  }
}

/// How many pedestrians across a generator's footprint is.
///
/// Three, at the brush's own pitch, which is the smallest block that still
/// gives somebody a way out when the middle of it is occupied -- and the
/// largest that still reads as a door rather than as a room.
public let GENERATOR_CELLS = 3

/// The square a generator occupies, in world units.
///
/// Derived from the pedestrian radius rather than stored, so it is the size of
/// the people coming out of it at whatever the radius slider says -- the same
/// bargain the brush block makes. Drawing, hit-testing and the placement
/// preview all call this, so all three agree by construction.
public func generatorSquare(_ at: Point, _ radius: Double) -> [Point] {
  let half = Double(GENERATOR_CELLS) * radius
  return rectanglePolygon(Point(at.x - half, at.y - half),
                          Point(at.x + half, at.y + half))
}

/// How much of the block's half-width each corner is rounded off by, and how
/// many segments that arc gets. About a fifth of the side, the proportion an
/// app icon uses: enough that the corner is unmistakably not a wall's from
/// across the map, little enough that the shape still reads as a block.
private let GENERATOR_CORNER: Double = 0.45
private let GENERATOR_CORNER_SEGMENTS = 6

/// The generator as it is drawn: the same square with its corners taken off.
///
/// A map made of walls is a map made of hard rectangles, and a door drawn as one
/// more of them is a block you have to work out rather than recognise. Rounded,
/// it reads as a thing placed on the floor at a glance and at any zoom.
///
/// The footprint underneath is unchanged: `generatorSquare` is still what the
/// block occupies and what has to have room in it. This is the same square,
/// drawn.
public func generatorRoundedSquare(_ at: Point, _ radius: Double) -> [Point] {
  let half = Double(GENERATOR_CELLS) * radius
  let r = half * GENERATOR_CORNER
  // One quarter-turn per corner, in the winding `rectanglePolygon` uses, each
  // given the centre it turns about and the angle it starts from.
  let corners: [(Double, Double, Double)] = [
    (at.x - half + r, at.y - half + r, Double.pi),
    (at.x + half - r, at.y - half + r, -Double.pi / 2),
    (at.x + half - r, at.y + half - r, 0),
    (at.x - half + r, at.y + half - r, Double.pi / 2),
  ]
  var points: [Point] = []
  for (ox, oy, from) in corners {
    for i in 0...GENERATOR_CORNER_SEGMENTS {
      let a = from + (Double.pi / 2) * (Double(i) / Double(GENERATOR_CORNER_SEGMENTS))
      points.append(Point(ox + r * jsCos(a), oy + r * jsSin(a)))
    }
  }
  return points
}

/// Whether a point is on a generator's block.
public func generatorContains(_ generator: Generator, _ p: Point, _ radius: Double) -> Bool {
  let half = Double(GENERATOR_CELLS) * radius
  return abs(p.x - generator.at.x) <= half && abs(p.y - generator.at.y) <= half
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
