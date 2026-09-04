import Foundation

/// The world a fixture was recorded from.
///
/// Walls and goals are referred to by *index*, never by id: ids come from a
/// run-local counter in model.ts, so a fixture that carried them would change
/// whenever a scenario was added above it, and could not be reproduced by a
/// test that built one scenario alone.
public struct Manifest: Decodable {
  public struct Wall: Decodable {
    public let index: Int
    /// Each polygon is a closed ring of [x, y] pairs.
    public let polygons: [[[Double]]]
    public let color: [Int]
    public let isGoal: Bool
    public let isBorder: Bool
  }
  public struct Placement: Decodable {
    public let x: Double
    public let y: Double
    /// Index into `walls`, or -1 for a pedestrian with nowhere to be.
    public let goal: Int
  }

  public let kind: String
  public let name: String
  public let proves: String
  public let radius: Double
  public let walls: [Wall]
  public let speed: Double?
  public let personalSpace: Double?
  public let ticks: Int?
  public let agents: [Placement]?
}

/// A recorded run: one checksum per tick, full records at checkpoints.
public struct TraceFixture {
  public static let magic: UInt32 = 0x5254_4b57  // "WKTR"
  public static let version: UInt32 = 2
  /// float32 x, y, headingX, headingY; int32 goal; uint8 arrived; int32 party; float32 stalled, pressure.
  public static let recordBytes = 33

  public struct Checkpoint {
    public let tick: Int
    public let count: Int
    public let bytes: Data
  }

  public let name: String
  public let radius: Double
  public let speed: Double
  public let personalSpace: Double
  public let agentCount: Int
  public let checkpointEvery: Int
  public let checksums: [UInt64]
  public let checkpoints: [Checkpoint]

  public init(contentsOf url: URL) throws {
    var r = ByteReader(try Data(contentsOf: url))
    let m = try r.u32()
    guard m == Self.magic else { throw ByteReader.Err.badMagic(got: m, want: Self.magic) }
    let v = try r.u32()
    guard v == Self.version else { throw ByteReader.Err.badVersion(got: v, want: Self.version) }
    name = try r.string(Int(try r.u16()))
    radius = try r.f64()
    speed = try r.f64()
    personalSpace = try r.f64()
    let tickCount = Int(try r.u32())
    checkpointEvery = Int(try r.u32())
    agentCount = Int(try r.u32())

    let start = r.offset
    var sums = [UInt64](); sums.reserveCapacity(tickCount)
    for _ in 0..<tickCount { sums.append(try r.u64()) }
    checksums = sums

    var cps: [Checkpoint] = []
    let cpCount = Int(try r.u32())
    for _ in 0..<cpCount {
      let tick = Int(try r.u32())
      let count = Int(try r.u32())
      cps.append(Checkpoint(tick: tick, count: count,
                            bytes: try r.bytes(count * Self.recordBytes)))
    }
    checkpoints = cps

    let want = r.fnv1a64(from: start, to: r.offset)
    guard try r.u64() == want else { throw ByteReader.Err.checksum }
  }
}

/// A visibility graph and its routing fields, with nothing stepped.
///
/// The highest-value fixtures in the set: once a crowd is walking, a geometry
/// bug and a behaviour bug look identical from the outside. Pinning the graph
/// first halves the space a divergence can hide in.
public struct GraphFixture {
  public static let magic: UInt32 = 0x5247_4b57  // "WKGR"
  public static let version: UInt32 = 1

  public struct Field {
    /// Index into the scenario's walls, not a wall id.
    public let goalIndex: Int32
    public let dist: [Float]
    public let prev: [Int32]
  }

  public let name: String
  public let nodes: [(x: Double, y: Double)]
  public let nodeWall: [Int32]
  public let nodePart: [Int32]
  public let nodeRingIndex: [Int32]
  public let ringLength: [Int32]
  public let offsets: [Int32]
  public let targets: [Int32]
  public let weights: [Float]
  public let fields: [Field]

  public var nodeCount: Int { nodes.count }
  public var edgeCount: Int { targets.count }

  public init(contentsOf url: URL) throws {
    var r = ByteReader(try Data(contentsOf: url))
    let m = try r.u32()
    guard m == Self.magic else { throw ByteReader.Err.badMagic(got: m, want: Self.magic) }
    let v = try r.u32()
    guard v == Self.version else { throw ByteReader.Err.badVersion(got: v, want: Self.version) }
    name = try r.string(Int(try r.u16()))

    let start = r.offset
    let n = Int(try r.u32())
    var pts: [(x: Double, y: Double)] = []; pts.reserveCapacity(n)
    // Node positions stay float64: they come out of expandPolygon, the most
    // numerically delicate thing in sim/, and rounding would hide the very
    // disagreement worth catching.
    for _ in 0..<n { pts.append((try r.f64(), try r.f64())) }
    nodes = pts
    nodeWall = try r.i32s(n)
    nodePart = try r.i32s(n)
    nodeRingIndex = try r.i32s(n)
    ringLength = try r.i32s(n)
    let edges = Int(try r.u32())
    offsets = try r.i32s(n + 1)
    targets = try r.i32s(edges)
    weights = try r.f32s(edges)

    var fs: [Field] = []
    let goalCount = Int(try r.u32())
    for _ in 0..<goalCount {
      fs.append(Field(goalIndex: try r.i32(), dist: try r.f32s(n), prev: try r.i32s(n)))
    }
    fields = fs

    let want = r.fnv1a64(from: start, to: r.offset)
    guard try r.u64() == want else { throw ByteReader.Err.checksum }
  }
}

/// Everything in `ios/Fixtures`, paired with its manifest.
public enum FixtureSet {
  public struct Entry {
    public let manifest: Manifest
    public let url: URL
  }

  public static func load(from dir: URL) throws -> (graphs: [Entry], traces: [Entry]) {
    let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
      .filter { $0.hasSuffix(".json") }
      .sorted()
    var graphs: [Entry] = []
    var traces: [Entry] = []
    for n in names {
      let jsonURL = dir.appendingPathComponent(n)
      let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: jsonURL))
      let stem = String(n.dropLast(5))
      switch manifest.kind {
      case "graph": graphs.append(Entry(manifest: manifest, url: dir.appendingPathComponent("\(stem).wkgr")))
      case "trace": traces.append(Entry(manifest: manifest, url: dir.appendingPathComponent("\(stem).wktr")))
      default: continue
      }
    }
    return (graphs, traces)
  }
}
