import Foundation

/// A uniform grid over wall groups, so a visibility test looks at the buildings
/// near it rather than at every building on the map.
///
/// `isVisible`, `insideAnyWall` and `inShell` were each a linear pass over every
/// wall group with a bounding-box reject, which is ample for the hundreds of
/// corners a hand-drawn map produces and quadratic nonsense on an imported
/// neighbourhood. Measured on a 600m Winterthur import -- 540 buildings, 3,393
/// graph nodes -- one tick with 1,000 pedestrians cost **1,219ms in release**,
/// about seventy times the frame budget, and a sampling profile put nearly all
/// of it in `isVisible` and `segmentsCross` underneath `stepTowards` and
/// `nextWaypoint`. `insideAnyWall` was the worst of them: for each of 540
/// obstacles it called `inShell`, which scanned all 540 shells.
///
/// **This changes no answer.** Every group the grid skips is one whose bounding
/// box does not meet the query, which is precisely what the `segmentMissesBox`
/// and bbox tests already rejected -- the grid stops them being *visited*, not
/// tested differently. Order within a query may differ, and cannot matter:
/// `isVisible` and `insideAnyWall` both return on the first blocker found, and
/// any blocker gives the same answer. `walky-conform` holds it to that.
///
/// Results land in a reused buffer and are valid until the next query, the same
/// contract `SpatialHash` documents and for the same reason: this sits in the
/// hottest loop in the program and an `ArraySlice` would copy-on-write on every
/// lookup of every agent every tick.
public final class BlockerIndex {
  /// Group indices from the last query, valid until the next one.
  public private(set) var results = [Int32](repeating: 0, count: 64)
  public private(set) var resultCount = 0

  private var cellSize: Double = 1
  private var minX: Double = 0
  private var minY: Double = 0
  private var cols = 0
  private var rows = 0
  /// Group indices per cell, flattened: `cellStart[c]..<cellStart[c + 1]`.
  private var cellStart: [Int32] = [0]
  private var items: [Int32] = []
  /// One stamp per group, so a group spanning several cells is tested once.
  private var stamp: [Int32] = []
  private var generation: Int32 = 0
  private var groupCount = 0

  public init() {}

  /// Builds the grid from each group's bounding box.
  public func build(_ groups: [WallPartGroup]) {
    groupCount = groups.count
    stamp = [Int32](repeating: 0, count: groupCount)
    generation = 0
    guard groupCount > 0 else {
      cols = 0; rows = 0; cellStart = [0]; items = []
      return
    }

    var boxes = [BBox]()
    boxes.reserveCapacity(groupCount)
    var lowX = Double.infinity, lowY = Double.infinity
    var highX = -Double.infinity, highY = -Double.infinity
    for g in groups {
      var b = g.shell?.bbox
        ?? BBox(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
      for part in g.parts {
        b.minX = Swift.min(b.minX, part.bbox.minX)
        b.minY = Swift.min(b.minY, part.bbox.minY)
        b.maxX = Swift.max(b.maxX, part.bbox.maxX)
        b.maxY = Swift.max(b.maxY, part.bbox.maxY)
      }
      boxes.append(b)
      if b.minX.isFinite {
        lowX = Swift.min(lowX, b.minX); highX = Swift.max(highX, b.maxX)
        lowY = Swift.min(lowY, b.minY); highY = Swift.max(highY, b.maxY)
      }
    }
    guard lowX.isFinite else {
      cols = 0; rows = 0; cellStart = [0]; items = []
      return
    }

    // About two groups to a cell: enough that a query touches few, not so fine
    // that a building spans a hundred cells and is inserted into all of them.
    let area = Swift.max(1, (highX - lowX) * (highY - lowY))
    cellSize = Swift.max(1, (area / Double(Swift.max(1, groupCount)) / 2).squareRoot())
    minX = lowX
    minY = lowY
    cols = Swift.max(1, Int((highX - lowX) / cellSize) + 1)
    rows = Swift.max(1, Int((highY - lowY) / cellSize) + 1)

    // Counting sort into a flat table, as SpatialHash does.
    var counts = [Int32](repeating: 0, count: cols * rows + 1)
    func span(_ b: BBox) -> (Int, Int, Int, Int) {
      let x0 = clampCol(Int((b.minX - minX) / cellSize))
      let x1 = clampCol(Int((b.maxX - minX) / cellSize))
      let y0 = clampRow(Int((b.minY - minY) / cellSize))
      let y1 = clampRow(Int((b.maxY - minY) / cellSize))
      return (x0, x1, y0, y1)
    }
    for b in boxes where b.minX.isFinite {
      let (x0, x1, y0, y1) = span(b)
      for gy in y0...y1 { for gx in x0...x1 { counts[gy * cols + gx + 1] += 1 } }
    }
    for c in 1..<counts.count { counts[c] += counts[c - 1] }
    cellStart = counts
    items = [Int32](repeating: 0, count: Int(counts[counts.count - 1]))
    var cursor = counts
    for (i, b) in boxes.enumerated() where b.minX.isFinite {
      let (x0, x1, y0, y1) = span(b)
      for gy in y0...y1 {
        for gx in x0...x1 {
          let cell = gy * cols + gx
          items[Int(cursor[cell])] = Int32(i)
          cursor[cell] += 1
        }
      }
    }
  }

  private func clampCol(_ v: Int) -> Int { Swift.min(Swift.max(0, v), Swift.max(0, cols - 1)) }
  private func clampRow(_ v: Int) -> Int { Swift.min(Swift.max(0, v), Swift.max(0, rows - 1)) }

  /// Groups whose bounding box could meet the segment `a`-`b`.
  @discardableResult
  public func query(_ a: Point, _ b: Point) -> Int {
    guard cols > 0 else { resultCount = 0; return 0 }
    beginQuery()

    // Clipped to the grid before walking it, which is not tidiness: pedestrians
    // stand outside the buildings' bounding box all the time, and clamping the
    // *endpoints* into the grid instead would start the walk at the wrong place
    // and let it march off the true line, silently skipping cells the segment
    // really crosses. That cost three fixtures.
    guard let (ca, cb) = clipped(a, b) else { resultCount = 0; return 0 }

    // Walk the cells the segment passes through, rather than the rectangle it
    // spans: a long diagonal across an import covers most of the map as a
    // rectangle and a thin line as a walk.
    let x0 = clampCol(Int((ca.x - minX) / cellSize))
    let y0 = clampRow(Int((ca.y - minY) / cellSize))
    let x1 = clampCol(Int((cb.x - minX) / cellSize))
    let y1 = clampRow(Int((cb.y - minY) / cellSize))

    var gx = x0, gy = y0
    _ = (x1, y1)
    // From the direction, **not** from the cell indices. Deriving them from
    // `x1 > x0` gives a step of zero for a near-vertical segment that stays in
    // one column, and the walk then stops on its first cell -- 223 segments in
    // 20,000 disagreed with the linear scan, and three fixtures with it.
    let stepX = cb.x > ca.x ? 1 : (cb.x < ca.x ? -1 : 0)
    let stepY = cb.y > ca.y ? 1 : (cb.y < ca.y ? -1 : 0)
    let dx = abs(cb.x - ca.x), dy = abs(cb.y - ca.y)

    // Distance along the segment to the next vertical and horizontal boundary,
    // in units of the segment's own length: a standard grid walk.
    var tMaxX = dx > 0
      ? ((Double(gx + (stepX > 0 ? 1 : 0)) * cellSize + minX) - ca.x) / (cb.x - ca.x)
      : Double.infinity
    var tMaxY = dy > 0
      ? ((Double(gy + (stepY > 0 ? 1 : 0)) * cellSize + minY) - ca.y) / (cb.y - ca.y)
      : Double.infinity
    let tDeltaX = dx > 0 ? cellSize / dx : Double.infinity
    let tDeltaY = dy > 0 ? cellSize / dy : Double.infinity

    var guardCount = 0
    let limit = cols + rows + 4
    while true {
      take(gy * cols + gx)
      // Stop when the next boundary is past the end of the segment, rather than
      // when the end *cell* is reached: the walk can pass through the end cell's
      // column or row without landing on it exactly.
      if jsMin(tMaxX, tMaxY) > 1 { break }
      guardCount += 1
      if guardCount > limit { break }
      if tMaxX < tMaxY {
        gx += stepX; tMaxX += tDeltaX
      } else {
        gy += stepY; tMaxY += tDeltaY
      }
      if gx < 0 || gx >= cols || gy < 0 || gy >= rows { break }
    }
    return resultCount
  }

  /// Groups whose bounding box contains the point.
  @discardableResult
  public func query(_ p: Point) -> Int {
    guard cols > 0 else { resultCount = 0; return 0 }
    beginQuery()
    take(clampRow(Int((p.y - minY) / cellSize)) * cols + clampCol(Int((p.x - minX) / cellSize)))
    return resultCount
  }

  /// Groups whose bounding box meets a box, for a handful of points at once.
  ///
  /// `Behaviour.stepTowards` tests nine candidate positions a substep, all
  /// within one step -- at most sqrt(2) units -- of each other, against a cell
  /// about a thousand units wide. Nine queries for nine points inside one cell
  /// is eight queries too many, so the box covering all of them is asked once
  /// and the answer reused. A box that small spans four cells at worst.
  @discardableResult
  public func query(minX lowX: Double, minY lowY: Double,
                    maxX highX: Double, maxY highY: Double) -> Int {
    guard cols > 0 else { resultCount = 0; return 0 }
    beginQuery()
    let x0 = clampCol(Int((lowX - minX) / cellSize))
    let x1 = clampCol(Int((highX - minX) / cellSize))
    let y0 = clampRow(Int((lowY - minY) / cellSize))
    let y1 = clampRow(Int((highY - minY) / cellSize))
    for gy in y0...y1 { for gx in x0...x1 { take(gy * cols + gx) } }
    return resultCount
  }

  /// The part of `a`-`b` that lies inside the grid, or nil when none does.
  /// Liang-Barsky, with the grid's own rectangle as the window.
  private func clipped(_ a: Point, _ b: Point) -> (Point, Point)? {
    let maxX = minX + Double(cols) * cellSize
    let maxY = minY + Double(rows) * cellSize
    var t0 = 0.0, t1 = 1.0
    let dx = b.x - a.x, dy = b.y - a.y

    // Each edge in turn: p is the direction into the window, q how far outside.
    func clip(_ p: Double, _ q: Double) -> Bool {
      if p == 0 { return q >= 0 }        // parallel: inside only if not outside
      let r = q / p
      if p < 0 {
        if r > t1 { return false }
        if r > t0 { t0 = r }
      } else {
        if r < t0 { return false }
        if r < t1 { t1 = r }
      }
      return true
    }

    guard clip(-dx, a.x - minX), clip(dx, maxX - a.x),
          clip(-dy, a.y - minY), clip(dy, maxY - a.y) else { return nil }
    return (Point(a.x + t0 * dx, a.y + t0 * dy), Point(a.x + t1 * dx, a.y + t1 * dy))
  }

  private func beginQuery() {
    resultCount = 0
    generation &+= 1
    // Wrapped: clear rather than let a stale stamp read as visited.
    if generation == 0 {
      for i in 0..<stamp.count { stamp[i] = 0 }
      generation = 1
    }
  }

  private func take(_ cell: Int) {
    guard cell >= 0 && cell + 1 < cellStart.count else { return }
    var k = Int(cellStart[cell])
    let end = Int(cellStart[cell + 1])
    while k < end {
      defer { k += 1 }
      let g = items[k]
      if stamp[Int(g)] == generation { continue }
      stamp[Int(g)] = generation
      if resultCount == results.count {
        results.append(contentsOf: [Int32](repeating: 0, count: results.count))
      }
      results[resultCount] = g
      resultCount += 1
    }
  }
}
