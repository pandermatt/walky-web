import Foundation
import RoomPlan
import simd
import WalkyCore
import WalkyGeo
import WalkySim

/// Walking round your own room and putting it on the map.
///
/// The counterpart to `MapImporter`, and shaped like it on purpose -- a phase
/// enum, an optional fraction, an `install` that ends in `navReady()`. What is
/// different is where the work lives: RoomPlan needs LiDAR, so **none of this
/// runs in the Simulator**, and the arithmetic that decides where a wall lands
/// is in `WalkyGeo.roomWalls` where a test can reach it. All that is left here
/// is reading transforms off `CapturedRoom` and deciding what a doorway is for.
///
/// A room is the one map worth having at life size. The scale slider exists
/// because a 380m city at 1:1 draws a pedestrian half a pixel wide; a 4m room
/// at 1:1 is 224 world units against a pedestrian's 26, so eight people fit
/// across it. No anchor is set, which is also what makes `measure` report real
/// metres -- it falls back to a ratio of 1.
@MainActor
@Observable
final class RoomScanner {
  /// What a doorway should do once the room is on the map.
  enum Role: String, CaseIterable, Identifiable {
    /// A Walky door just inside, letting people in.
    case entrance
    /// A slab filling the gap, marked as the goal: reaching your doorway is
    /// leaving the room.
    case exit
    /// A hole, and nothing else.
    case open

    var id: String { rawValue }
    var label: String {
      switch self {
      case .entrance: "In"
      case .exit: "Out"
      case .open: "Open"
      }
    }
  }

  enum Phase: Equatable {
    case idle
    /// No LiDAR: an iPhone Pro or iPad Pro scans, and nothing else can.
    case unsupported
    case scanning
    /// RoomPlan turning what it saw into a floor plan.
    case processing
    /// Scanned and waiting: the doorways are listed and their roles are picked
    /// before the room is placed, because changing one afterwards would mean
    /// importing again.
    case ready(ScannedRoom)
    case placing
    /// The visibility rebuild, as `MapImporter` labels it.
    case routing
    case done(String)
    case failed(String)
  }

  private(set) var phase: Phase = .idle
  private(set) var progress: Double?
  /// Furniture as obstacles. On by default: a table is the most interesting
  /// thing in a room to walk around, and it is what makes the crowd part.
  var includeFurniture = true
  /// What each doorway is for, keyed by its index in `doorways`.
  private(set) var roles: [Int: Role] = [:]
  private(set) var doorways: [Doorway] = []

  private var room: ScannedRoom?

  /// A scan landed. The capture sheet is closing at this moment and there is no
  /// settings sheet behind it -- swapping the one sheet is what put the capture
  /// view up -- so without this, finishing a scan drops you on the map with
  /// nothing to show for the walk you just took. It happened on the first real
  /// device run: Done appeared to do nothing, and the room had to be fetched
  /// afterwards through "Load the last scan".
  var onScanned: (() -> Void)?
  /// The summary line, for the notice capsule, since the sheet that would have
  /// shown it is gone by the time a scan is placed.
  var onNotice: ((String) -> Void)?

  /// Whether there is a room in hand to place, or place again with different
  /// doorway roles.
  var hasRoom: Bool { room != nil }

  var isBusy: Bool {
    switch phase {
    case .scanning, .processing, .placing, .routing: true
    default: false
    }
  }

  var canScan: Bool { RoomCaptureSession.isSupported }

  // MARK: - Capture

  func startScan() {
    guard canScan else {
      phase = .unsupported
      return
    }
    room = nil
    doorways = []
    roles = [:]
    step(.scanning)
  }

  /// The scan was cancelled, or the sheet was swiped away mid-walk.
  func cancelScan() {
    if case .scanning = phase { step(.idle) }
    if case .processing = phase { step(.idle) }
  }

  func captureFailed(_ why: String) {
    progress = nil
    phase = .failed(why)
  }

  /// RoomPlan's answer, converted, kept, and put straight on the map.
  ///
  /// Placed rather than merely offered, which is the asymmetry with the sample
  /// and the saved scan: those are pressed *inside* Settings, where the doorway
  /// roles and the Place button are already on screen, and a scan ends with
  /// every sheet closed. The roles stay editable afterwards -- see `hasRoom` --
  /// so this is a default rather than a decision taken away.
  func captured(_ captured: CapturedRoom) {
    accept(ScannedRoom(captured))
    save()
    onScanned?()
  }

  /// The room to develop and demonstrate against on a device with no LiDAR --
  /// which includes every Simulator. See `ScannedRoom.sample`.
  func loadSample() {
    accept(.sample)
  }

  /// The last scan, if there is one. What stops a second look at your own room
  /// costing a second walk round it.
  func loadSaved() {
    guard let url = Self.savedURL,
          let data = try? Data(contentsOf: url),
          let room = try? JSONDecoder().decode(ScannedRoom.self, from: data) else {
      phase = .failed("No scan saved yet.")
      return
    }
    accept(room)
  }

  var hasSaved: Bool {
    guard let url = Self.savedURL else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  private func accept(_ room: ScannedRoom) {
    self.room = room
    refreshDoorways()
    progress = nil
    phase = .ready(room)
  }

  /// The doorways as the current options make them, with default roles.
  ///
  /// **The widest doorway is the way out and everything else is a way in**, so
  /// a three-door room runs the moment it is placed: people come in two doors
  /// and leave by the third. A room with one doorway makes it the exit -- the
  /// evacuation reading, which is the one that needs no crowd painted for you.
  private func refreshDoorways() {
    guard let room else { return }
    doorways = roomWalls(room, options).doorways
    guard !doorways.isEmpty else {
      roles = [:]
      return
    }
    let widest = doorways.indices.max { doorways[$0].metres < doorways[$1].metres }
    var picked: [Int: Role] = [:]
    for i in doorways.indices { picked[i] = i == widest ? .exit : .entrance }
    roles = picked
  }

  func setRole(_ role: Role, at index: Int) {
    guard doorways.indices.contains(index) else { return }
    roles[index] = role
  }

  func furnitureChanged() {
    // The furniture toggle moves no doorway, but the conversion is cheap and
    // re-running it keeps one source of truth rather than two.
    if case .ready = phase { refreshDoorways() }
  }

  private var options: RoomOptions {
    RoomOptions(includeFurniture: includeFurniture)
  }

  /// Any doorway a pedestrian cannot fit through at the shipped size.
  ///
  /// Worth saying out loud rather than leaving to be discovered: a gap admits
  /// somebody above two radii, so at the default 0.46m body a 0.4m gap between
  /// a wall and a wardrobe is solid, and the crowd will simply never use it.
  func tooNarrow(_ radius: Double) -> [Doorway] {
    doorways.filter { gapSeals($0.metres * PX_PER_METRE, radius) }
  }

  // MARK: - Placing it

  func place(into world: WalkyWorld) {
    guard let room else { return }
    let plan = roomWalls(room, options)
    guard !plan.walls.isEmpty else {
      phase = .failed("That scan has no walls in it.")
      return
    }

    Task {
      step(.placing)
      world.clearAll()
      // No anchor: a room is not a place on the earth, and the nil is what
      // makes `measure` report at 1:1.
      world.addWalls(plan.walls)
      if !plan.furniture.isEmpty {
        // A duller colour than the walls, and its own edit -- undoing furniture
        // without losing the room is the thing somebody will want.
        world.addWalls(plan.furniture, WallOptions(color: (120, 120, 130)))
      }

      // Order matters, and only because of how goals work: `setGoalAt` is what
      // aims the doors, and a door with no goal emits nobody. So the slabs go
      // down, then the doors, then the aim.
      var exit: Point?
      for (i, doorway) in plan.doorways.enumerated() where roles[i] == .exit {
        if world.addWallShape([doorway.slab], WallOptions(color: (0, 200, 120))) {
          exit = doorway.at
        }
      }
      for (i, doorway) in plan.doorways.enumerated() where roles[i] == .entrance {
        // **The gap is filled.** A doorway that people arrive through does not
        // also need to be a hole -- the Walky door is the hole's whole
        // function -- and leaving it open makes the room leak: the first thing
        // the crowd did on the sample room was walk back out of the doorway it
        // had just come in by, because the route round the outside to the exit
        // was shorter than the one past the table. A sealed room is what makes
        // "In" mean something different from "Open".
        world.addWallShape([doorway.slab], WallOptions(color: (90, 90, 100)))

        // Not in the gap: `GENERATOR_CELLS` wants a 1.4m block and a doorway is
        // 0.9m, so the door stands on the floor just inside, along the inward
        // normal the conversion worked out.
        let inward = doorway.inward ?? Point(0, 0)
        let inside = Point(doorway.at.x + inward.x * DOOR_STAND_BACK,
                           doorway.at.y + inward.y * DOOR_STAND_BACK)
        world.addGenerator(world.standable(inside))
      }
      if let exit { world.setGoalAt(exit) }

      world.frameImport()
      step(.routing)
      await world.navReady()

      progress = nil
      let line = summary(plan, hasExit: exit != nil)
      phase = .done(line)
      onNotice?(line)
    }
  }

  /// How far inside the room a Walky door stands, in world units.
  ///
  /// One pedestrian block deep, so the block it needs is on the floor rather
  /// than in the doorframe, and the people it lets out are already in the room
  /// and walking rather than wedged in the gap.
  private let DOOR_STAND_BACK: Double = 13 * 3

  private func summary(_ plan: RoomImport, hasExit: Bool) -> String {
    var parts = ["\(plan.walls.count) walls"]
    if !plan.furniture.isEmpty { parts.append("\(plan.furniture.count) obstacles") }
    let doors = roles.values.filter { $0 == .entrance }.count
    if doors > 0 { parts.append("\(doors) \(doors == 1 ? "door" : "doors")") }
    var line = parts.joined(separator: ", ")
      + ", \(String(format: "%.1f", plan.metresAcross))m across at 1:1."
    if !hasExit && doors > 0 {
      // A door with nowhere to send anybody stands there doing nothing, which
      // reads as the import having failed.
      line += " Set a doorway to Out, or tap a wall to make it the goal."
    }
    return line
  }

  // MARK: - Keeping it

  private static var savedURL: URL? {
    guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory,
                                                 in: .userDomainMask,
                                                 appropriateFor: nil, create: true)
    else { return nil }
    return dir.appendingPathComponent("walky-last-scan.json")
  }

  private func save() {
    guard let room, let url = Self.savedURL else { return }
    // Best effort by design: a scan that cannot be cached is still a scan, and
    // failing the import over it would be the wrong trade.
    try? JSONEncoder().encode(room).write(to: url, options: .atomic)
  }

  private func step(_ next: Phase, _ fraction: Double? = nil) {
    phase = next
    progress = fraction ?? Self.fraction(of: next)
  }

  /// Weights, and honest about it -- as `MapImporter.fraction` is. Scanning has
  /// no length to report: it ends when you say it does.
  private static func fraction(of phase: Phase) -> Double? {
    switch phase {
    case .processing: 0.4
    case .placing: 0.75
    case .routing: nil
    default: nil
    }
  }
}

// MARK: - RoomPlan, reduced to a floor plan

extension ScannedRoom {
  /// `CapturedRoom` as the flat rectangles the conversion works in.
  ///
  /// The whole of the RoomPlan-specific code, and deliberately dull: read the
  /// translation and the yaw out of each transform, keep the width, and throw
  /// away the height. Everything with a decision in it is in `roomWalls`, in a
  /// target that builds without this framework.
  init(_ captured: CapturedRoom) {
    var rects: [ScanRect] = []

    for surface in captured.walls {
      rects.append(ScanRect(surface, kind: .wall, depth: WALL_THICKNESS))
    }
    for surface in captured.doors {
      rects.append(ScanRect(surface, kind: .door, depth: WALL_THICKNESS, label: "Door"))
    }
    for surface in captured.openings {
      rects.append(ScanRect(surface, kind: .opening, depth: WALL_THICKNESS, label: "Opening"))
    }
    for surface in captured.windows {
      rects.append(ScanRect(surface, kind: .window, depth: WALL_THICKNESS, label: "Window"))
    }
    for object in captured.objects {
      // An object has a real footprint, unlike a wall: its own z extent.
      rects.append(ScanRect(kind: .object,
                            centreX: Double(object.transform.columns.3.x),
                            centreZ: Double(object.transform.columns.3.z),
                            width: Double(object.dimensions.x),
                            depth: Double(object.dimensions.z),
                            yaw: planYaw(object.transform),
                            label: name(object.category),
                            confident: object.confidence != .low))
    }

    self.init(rects: rects)
  }
}

private extension ScanRect {
  init(_ surface: CapturedRoom.Surface, kind: ScanKind, depth: Double, label: String? = nil) {
    self.init(kind: kind,
              centreX: Double(surface.transform.columns.3.x),
              centreZ: Double(surface.transform.columns.3.z),
              width: Double(surface.dimensions.x),
              depth: depth,
              yaw: planYaw(surface.transform),
              label: label,
              confident: surface.confidence != .low)
  }
}

/// Rotation about the up axis, from a 4x4 whose x column is the surface's own
/// width direction. Screen y runs down and ARKit's z runs the same way in plan,
/// so this is the plan-view angle with no flip -- the fixture test that puts the
/// sample's door in the north wall is what pins that.
private func planYaw(_ transform: simd_float4x4) -> Double {
  atan2(Double(transform.columns.0.z), Double(transform.columns.0.x))
}

private func name(_ category: CapturedRoom.Object.Category) -> String {
  // `description` is a compiler-generated enum name, which is close enough to a
  // label for a readout and cannot fall out of date with the SDK.
  String(describing: category).capitalized
}
