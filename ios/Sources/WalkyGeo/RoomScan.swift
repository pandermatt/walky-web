import Foundation
import WalkySim

/// Turning a scanned room into a world.
///
/// The companion to `Footprints.swift`, and the same seam: RoomPlan lives in
/// `App/` because it is a framework, and the arithmetic that decides where a
/// wall lands lives here, framework-free, so `swift test` can check it on a
/// machine with no simulator. That matters more here than it did for the map
/// import -- RoomPlan needs LiDAR, so it does not run in the Simulator **at
/// all**, and everything below is the part that can still be proven.
///
/// The reason this is a small file rather than a large one is that Apple hands
/// over a finished floor plan rather than a mesh. Every wall, door, window,
/// opening and piece of furniture arrives as a transform and a size in metres,
/// which projects onto the floor as a rotated rectangle. There is no plane
/// fitting and no point cloud here, and the only interesting question is what
/// to do about doorways.

/// What a scanned rectangle is.
///
/// Mirrors the cases of `RoomPlan`'s `CapturedRoom.Surface.Category` plus its
/// `Object`, and deliberately loses everything else: a door's open-ness, a
/// surface's height, an object's category beyond a label. A floor plan is what
/// this simulator can use.
public enum ScanKind: String, Codable, Sendable {
  case wall, door, opening, window, object
}

/// One flat rectangle from a scan, on the floor plane, in **metres**.
///
/// A right-handed, y-up frame as ARKit reports it, reduced to the ground: `x`
/// and `z` of the transform's translation, the width along the rectangle's own
/// axis, and the yaw about the up axis. `depth` is across it -- RoomPlan's wall
/// surfaces are planes with no thickness at all, so a wall arrives here with
/// `WALL_THICKNESS` already filled in by whoever built it.
public struct ScanRect: Codable, Sendable, Equatable {
  public var kind: ScanKind
  public var centreX: Double
  public var centreZ: Double
  public var width: Double
  public var depth: Double
  /// Radians about the up axis.
  public var yaw: Double
  /// RoomPlan's own category name, for the readout. Nil for walls.
  public var label: String?
  /// False where RoomPlan said `.low`. Kept rather than dropped at the source,
  /// so the decision belongs to the import and can be turned off.
  public var confident: Bool

  public init(kind: ScanKind, centreX: Double, centreZ: Double,
              width: Double, depth: Double, yaw: Double,
              label: String? = nil, confident: Bool = true) {
    self.kind = kind
    self.centreX = centreX
    self.centreZ = centreZ
    self.width = width
    self.depth = depth
    self.yaw = yaw
    self.label = label
    self.confident = confident
  }
}

/// A whole scan, as the app hands it over and as a fixture stores it.
///
/// `Codable` on purpose and twice over: a scan taken on the phone is written to
/// Application Support so the room can be placed again without walking round it
/// a second time, and a sample can be written down in a test. Deliberately not
/// `CapturedRoom`, which is also `Codable` -- decoding that needs the RoomPlan
/// framework, and this file is the half that must build without one.
public struct ScannedRoom: Codable, Sendable, Equatable {
  public var rects: [ScanRect]
  public init(rects: [ScanRect]) { self.rects = rects }

  public var walls: [ScanRect] { rects.filter { $0.kind == .wall } }
  public var objects: [ScanRect] { rects.filter { $0.kind == .object } }
  /// Doors and openings: the two kinds that make a hole somebody can walk
  /// through. A window is not one of them -- see `RoomOptions`.
  public var gaps: [ScanRect] { rects.filter { $0.kind == .door || $0.kind == .opening } }
}

/// How thick to make a wall, in metres.
///
/// RoomPlan reports a wall as a plane: `dimensions` carries width and height
/// and nothing across. Any positive thickness would block a crowd, since
/// navigation inflates every obstacle by a pedestrian radius anyway, but a wall
/// thinner than the rounding would collapse to a line and a wall much thicker
/// than a real one would eat the room. 10cm is a plasterboard partition.
public let WALL_THICKNESS: Double = 0.10

/// How much of a doorway to keep clear of its own frame, in metres.
///
/// Zero would be honest and unhelpful: a door's reported width is the opening,
/// and shaving a little off each side leaves the crowd a gap it can be sure of
/// rather than one that depends on the scanner's last centimetre.
public let DOORWAY_MARGIN: Double = 0.02

/// What a scan should become.
public struct RoomOptions: Sendable {
  /// Tables, chairs, sofas, beds and storage as obstacles.
  public var includeFurniture: Bool
  /// Drop what RoomPlan was not sure about.
  public var confidentOnly: Bool

  public init(includeFurniture: Bool = true, confidentOnly: Bool = true) {
    self.includeFurniture = includeFurniture
    self.confidentOnly = confidentOnly
  }
}

// A room is placed at life size, and there is no ratio to choose.
//
// The map import has a scale slider because a 380m city at 1:1 draws a
// pedestrian half a pixel wide. A room is the opposite problem and needs no
// slider at all: at 1:1 a 4m room is 224 world units against a pedestrian's 26,
// so eight people fit across it, and at 1:10 it would be 22 units -- a room
// narrower than one of the people in it. So `roomWalls` works in
// `PX_PER_METRE` directly rather than taking a ratio only one value of which
// makes sense.
//
// It also keeps `WalkyWorld.geoAnchor` nil for a scan, which is what makes
// `measure` report real metres: it falls back to `scale: 1`.

/// A hole in a wall the crowd can use, and where it is.
///
/// Carried out of the conversion because the room's own geometry is the only
/// place that knows which way is indoors: a Walky door dropped exactly in a
/// doorway has no room to stand (`GENERATOR_CELLS` wants 1.4m and a door is
/// 0.8m), so it goes on the floor just inside, along `inward`.
public struct Doorway: Sendable, Equatable {
  public var kind: ScanKind
  /// The middle of the gap, in world units.
  public var at: Point
  /// The gap, in real metres, for the readout and the warning.
  public var metres: Double
  /// Unit vector across the wall, pointing at the room. Nil when the room's
  /// shape does not say which side that is -- a lone wall has no inside.
  public var inward: Point?
  /// The gap as a polygon: what an exit slab fills, in world units.
  public var slab: [Point]

  public init(kind: ScanKind, at: Point, metres: Double, inward: Point?, slab: [Point]) {
    self.kind = kind
    self.at = at
    self.metres = metres
    self.inward = inward
    self.slab = slab
  }
}

/// A scan, converted.
public struct RoomImport: Sendable {
  /// One entry per wall, each a list of polygons: a wall split by two doors is
  /// three bars and still **one** wall, which is what `Wall.polygons` is for.
  /// One wall stays one object, one undo unit, and one shell for the visibility
  /// sweep, however many holes were cut in it.
  public var walls: [[[Point]]]
  /// Furniture, one wall each. Separate so the colour can differ and so the
  /// toggle does not have to re-run the conversion.
  public var furniture: [[[Point]]]
  public var doorways: [Doorway]
  /// The room's own extent in real metres, for the readout.
  public var metresAcross: Double

  public var wallCorners: Int {
    ImportBudget.vertices(walls.flatMap { $0 }) + ImportBudget.vertices(furniture.flatMap { $0 })
  }
}

/// The narrowest gap a pedestrian of this radius can pass, in world units.
///
/// `Behaviour.insideAnyWall` tests an agent's **centre** against hulls already
/// inflated by one radius, so what a gap has to leave is a centre band wider
/// than nothing: `gap > 2 * radius`. Measured at the shipped radius of 13 that
/// is 26 units, or 0.46m at 1:1 -- so a 0.8m interior door leaves a 0.34m band
/// and admits a queue, which is exactly what a door should do.
///
/// Note this is *half* what `MapImporter.sealsBelowMetres` reports for the same
/// question. That figure is `4 * radius`: the width at which two people pass,
/// which is the right number for a street and the wrong one for a doorway.
public func gapSeals(_ gapWorldUnits: Double, _ radius: Double) -> Bool {
  gapWorldUnits <= 2 * radius
}

/// A scan as walls.
///
/// Four steps, and the third is the only one with an argument in it:
///
/// 1. **Every rectangle becomes a rotated quad** on the floor plane. Plain
///    `Double` trigonometry -- this is outside the conformance-checked
///    simulation, as the map import already is.
/// 2. **Vertices are rounded to whole world units.** `footprintPolygons` does
///    not, but `orient` is exact only on integer coordinates
///    (`Geometry.swift:18`), and one unit is 1.8cm -- comfortably under what a
///    handheld scanner knows about a wall.
/// 3. **Doors and openings are cut out of their wall**, leaving one to three
///    bars that stay a single wall. Windows are left solid: a crowd walking out
///    of a first-floor window is a bug, not a feature.
/// 4. **Furniture is converted separately**, so it can be left out.
///
/// `mergeFootprints` is deliberately **not** applied. It hulls clusters of
/// touching shapes, and the walls of a room all touch: the hull of four walls
/// is the room, interior included, which would seal the very floor the crowd is
/// meant to walk on. `MERGE_SLACK` would refuse that, but a test asserts it
/// rather than trusting it.
public func roomWalls(_ room: ScannedRoom, _ options: RoomOptions = RoomOptions()) -> RoomImport {
  let perMetre = PX_PER_METRE
  let usable = { (r: ScanRect) in !options.confidentOnly || r.confident }

  let walls = room.walls.filter(usable)
  let gaps = room.gaps.filter(usable)
  let centre = roomCentre(walls, perMetre)

  var out: [[[Point]]] = []
  var doorways: [Doorway] = []
  out.reserveCapacity(walls.count)

  for wall in walls {
    let axis = Point(cos(wall.yaw), sin(wall.yaw))
    let mid = Point(wall.centreX * perMetre, wall.centreZ * perMetre)
    let half = wall.width * perMetre / 2
    let thickness = jsMax(1, wall.depth * perMetre)

    // Where along this wall each gap sits, as an interval of its own axis.
    var cuts: [(from: Double, to: Double, gap: ScanRect)] = []
    for gap in gaps where owns(wall, gap, perMetre) {
      let here = Point(gap.centreX * perMetre, gap.centreZ * perMetre)
      let along = (here.x - mid.x) * axis.x + (here.y - mid.y) * axis.y
      let reach = jsMax(1, (gap.width - 2 * DOORWAY_MARGIN) * perMetre / 2)
      cuts.append((along - reach, along + reach, gap))

      let across = Point(-axis.y, axis.x)
      doorways.append(Doorway(
        kind: gap.kind,
        at: rounded(here),
        metres: gap.width,
        inward: inward(from: here, towards: centre, across: across),
        slab: bar(mid: here, axis: axis, half: reach, thickness: thickness)))
    }
    cuts.sort { $0.from < $1.from }

    // The wall, minus its holes. Each remaining run is extended by half the
    // thickness at the ends that are the wall's own -- the trick `borderFrame`
    // uses, so two walls meeting at a corner leave no diagonal gap to slip
    // through -- and not at the ends that are a doorway, which would narrow it.
    var bars: [[Point]] = []
    var cursor = -half
    for cut in cuts {
      let stop = jsMin(half, cut.from)
      if stop - cursor > 1 {
        bars.append(run(mid: mid, axis: axis, from: cursor, to: stop, thickness: thickness,
                        growStart: cursor <= -half, growEnd: false))
      }
      cursor = jsMax(cursor, cut.to)
    }
    if half - cursor > 1 {
      bars.append(run(mid: mid, axis: axis, from: cursor, to: half, thickness: thickness,
                      growStart: cursor <= -half, growEnd: true))
    }
    if !bars.isEmpty { out.append(bars) }
  }

  var furniture: [[[Point]]] = []
  if options.includeFurniture {
    for object in room.objects where usable(object) {
      let mid = Point(object.centreX * perMetre, object.centreZ * perMetre)
      let box = bar(mid: mid, axis: Point(cos(object.yaw), sin(object.yaw)),
                    half: jsMax(1, object.width * perMetre / 2),
                    thickness: jsMax(1, object.depth * perMetre))
      furniture.append([box])
    }
  }

  return RoomImport(walls: out, furniture: furniture, doorways: doorways,
                    metresAcross: across(out + furniture, perMetre))
}

// MARK: - The pieces

/// Whether a gap belongs to this wall.
///
/// RoomPlan does carry a `parentIdentifier` on a door, and the app passes it on
/// where it has one -- but not every scan fills it in, and a fixture written by
/// hand has none at all. So the fallback is geometric and is what this file
/// actually relies on: a gap belongs to the wall it is closest to, provided it
/// is nearly parallel to it and within touching distance across.
private func owns(_ wall: ScanRect, _ gap: ScanRect, _ perMetre: Double) -> Bool {
  // Parallel to within 15 degrees, either way round.
  let turn = abs(remainder(wall.yaw - gap.yaw, .pi))
  guard turn < 0.26 else { return false }

  let axis = Point(cos(wall.yaw), sin(wall.yaw))
  let mid = Point(wall.centreX * perMetre, wall.centreZ * perMetre)
  let here = Point(gap.centreX * perMetre, gap.centreZ * perMetre)
  let along = (here.x - mid.x) * axis.x + (here.y - mid.y) * axis.y
  let out = (here.x - mid.x) * -axis.y + (here.y - mid.y) * axis.x

  // In front of the wall's own span, and close enough across it to be in it
  // rather than in the wall behind. Half a metre, which is thicker than any
  // wall a scanner reports and thinner than any room.
  let half = wall.width * perMetre / 2
  return abs(along) <= half + gap.width * perMetre / 2
      && abs(out) <= 0.5 * perMetre
}

/// One bar of a wall, from `from` to `to` along its axis.
private func run(mid: Point, axis: Point, from: Double, to: Double, thickness: Double,
                 growStart: Bool, growEnd: Bool) -> [Point] {
  let grow = thickness / 2
  let start = from - (growStart ? grow : 0)
  let end = to + (growEnd ? grow : 0)
  let centre = Point(mid.x + axis.x * (start + end) / 2,
                     mid.y + axis.y * (start + end) / 2)
  return bar(mid: centre, axis: axis, half: (end - start) / 2, thickness: thickness)
}

/// A rotated rectangle: `half` along the axis, `thickness` across it.
private func bar(mid: Point, axis: Point, half: Double, thickness: Double) -> [Point] {
  let across = Point(-axis.y * thickness / 2, axis.x * thickness / 2)
  let reach = Point(axis.x * half, axis.y * half)
  return [
    rounded(Point(mid.x - reach.x - across.x, mid.y - reach.y - across.y)),
    rounded(Point(mid.x + reach.x - across.x, mid.y + reach.y - across.y)),
    rounded(Point(mid.x + reach.x + across.x, mid.y + reach.y + across.y)),
    rounded(Point(mid.x - reach.x + across.x, mid.y - reach.y + across.y)),
  ]
}

private func rounded(_ p: Point) -> Point { Point(jsRound(p.x), jsRound(p.y)) }

/// The middle of the scanned walls, which stands in for "indoors".
private func roomCentre(_ walls: [ScanRect], _ perMetre: Double) -> Point? {
  guard !walls.isEmpty else { return nil }
  var x = 0.0, y = 0.0
  for wall in walls {
    x += wall.centreX * perMetre
    y += wall.centreZ * perMetre
  }
  return Point(x / Double(walls.count), y / Double(walls.count))
}

/// Which way across a wall the room is, as a unit vector.
private func inward(from here: Point, towards centre: Point?, across: Point) -> Point? {
  guard let centre else { return nil }
  let toCentre = Point(centre.x - here.x, centre.y - here.y)
  let side = toCentre.x * across.x + toCentre.y * across.y
  if abs(side) < 1e-9 { return nil }
  return side > 0 ? across : Point(-across.x, -across.y)
}

private func across(_ shapes: [[[Point]]], _ perMetre: Double) -> Double {
  var minX = Double.infinity, maxX = -Double.infinity
  var minY = Double.infinity, maxY = -Double.infinity
  for shape in shapes {
    for polygon in shape {
      for p in polygon {
        minX = jsMin(minX, p.x); maxX = jsMax(maxX, p.x)
        minY = jsMin(minY, p.y); maxY = jsMax(maxY, p.y)
      }
    }
  }
  guard minX.isFinite else { return 0 }
  return jsMax(maxX - minX, maxY - minY) / perMetre
}

// MARK: - A room to develop against

public extension ScannedRoom {
  /// A room with no phone in it.
  ///
  /// RoomPlan needs LiDAR, so it does not run in the Simulator at all -- this
  /// is what makes the rest of the feature developable, demonstrable and
  /// testable anyway, and it is why the app offers it as a button rather than
  /// hiding it behind a debug flag.
  ///
  /// A literal rather than a file on disk, and that is a deliberate trade. The
  /// golden fixtures live beside the package and are found through `#filePath`,
  /// which does not exist on a phone; shipping a JSON in the app bundle would
  /// mean the first `Bundle` use in a project that has none. Written down here
  /// it is available to both, and it reads as what it is.
  ///
  /// The shape is an ordinary 4 x 5m room: four walls, a 0.9m door in the north
  /// wall, a 1.4m opening in the west one, and a table with two chairs. North
  /// is -z, so the door sits at the top of the plan -- which is the assertion
  /// that catches the room coming out mirrored.
  static var sample: ScannedRoom {
    let w = 4.0, d = 5.0
    let t = WALL_THICKNESS
    return ScannedRoom(rects: [
      // North and south walls run along x; east and west along z.
      ScanRect(kind: .wall, centreX: 0, centreZ: -d / 2, width: w, depth: t, yaw: 0),
      ScanRect(kind: .wall, centreX: 0, centreZ: d / 2, width: w, depth: t, yaw: 0),
      ScanRect(kind: .wall, centreX: -w / 2, centreZ: 0, width: d, depth: t, yaw: .pi / 2),
      ScanRect(kind: .wall, centreX: w / 2, centreZ: 0, width: d, depth: t, yaw: .pi / 2),
      // A door in the north wall, a metre east of its middle.
      ScanRect(kind: .door, centreX: 1, centreZ: -d / 2, width: 0.9, depth: t, yaw: 0,
               label: "Door"),
      // A wide opening in the west wall.
      ScanRect(kind: .opening, centreX: -w / 2, centreZ: 0.5, width: 1.4, depth: t,
               yaw: .pi / 2, label: "Opening"),
      // A window, which stays solid.
      ScanRect(kind: .window, centreX: 0, centreZ: d / 2, width: 1.2, depth: t, yaw: 0,
               label: "Window"),
      // A dining set in the middle, turned off the axis so the rotation is
      // exercised by the thing the app actually shows.
      ScanRect(kind: .object, centreX: 0.2, centreZ: 0.3, width: 1.6, depth: 0.9,
               yaw: 0.35, label: "Table"),
      ScanRect(kind: .object, centreX: -0.7, centreZ: -0.4, width: 0.5, depth: 0.5,
               yaw: 0.35, label: "Chair"),
      ScanRect(kind: .object, centreX: 1.1, centreZ: 1.0, width: 0.5, depth: 0.5,
               yaw: 0.35, label: "Chair"),
    ])
  }
}
