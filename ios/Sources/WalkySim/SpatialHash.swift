import Foundation

/// Uniform grid over agent positions, rebuilt each tick by counting sort into
/// flat arrays. Ports `src/sim/spatialHash.ts`.
///
/// `query` writes into a buffer owned by this object and returns how many it
/// found, rather than returning a slice. That mirrors the JS, which hands back
/// a subarray view valid only until the next query -- and it matters: this is
/// the hottest allocation site in the program, and returning an `ArraySlice`
/// would copy-on-write on every neighbour lookup of every agent every tick.
public final class SpatialHash {
  private var cellSize: Double = 1
  private var cols = 1
  private var rows = 1
  private var minX: Double = 0
  private var minY: Double = 0
  /// Start of each cell's slice in `items`, length cols*rows + 1.
  private var cellStart = [Int32](repeating: 0, count: 2)
  private var items = [Int32]()
  private var cursor = [Int32](repeating: 0, count: 1)

  /// Scratch reused by `query`, so a lookup allocates nothing.
  public private(set) var results = [Int32](repeating: 0, count: 64)
  /// How many of `results` the last `query` filled.
  public private(set) var resultCount = 0

  public init() {}

  public func build(_ x: [Float], _ y: [Float], _ count: Int, _ cellSize: Double) {
    self.cellSize = jsMax(1, cellSize)

    if count == 0 {
      cols = 1; rows = 1
      minX = 0; minY = 0
      if cellStart.count < 2 { cellStart = [Int32](repeating: 0, count: 2) }
      for i in 0..<cellStart.count { cellStart[i] = 0 }
      return
    }

    var lowX = Double.infinity, lowY = Double.infinity
    var highX = -Double.infinity, highY = -Double.infinity
    for i in 0..<count {
      let xi = Double(x[i]), yi = Double(y[i])
      if xi < lowX { lowX = xi }
      if xi > highX { highX = xi }
      if yi < lowY { lowY = yi }
      if yi > highY { highY = yi }
    }
    minX = lowX
    minY = lowY
    cols = Swift.max(1, Int(((highX - lowX) / self.cellSize).rounded(.down)) + 1)
    rows = Swift.max(1, Int(((highY - lowY) / self.cellSize).rounded(.down)) + 1)

    let cellCount = cols * rows
    if cellStart.count < cellCount + 1 { cellStart = [Int32](repeating: 0, count: cellCount + 1) }
    if cursor.count < cellCount { cursor = [Int32](repeating: 0, count: cellCount) }
    if items.count < count { items = [Int32](repeating: 0, count: count) }
    for i in 0...cellCount { cellStart[i] = 0 }

    // Counting sort: tally, prefix-sum, scatter.
    for i in 0..<count { cellStart[cellOf(Double(x[i]), Double(y[i])) + 1] += 1 }
    for c in 0..<cellCount { cellStart[c + 1] += cellStart[c] }
    for c in 0..<cellCount { cursor[c] = cellStart[c] }
    for i in 0..<count {
      let c = cellOf(Double(x[i]), Double(y[i]))
      items[Int(cursor[c])] = Int32(i)
      cursor[c] += 1
    }
  }

  /// Indices within `radius` of (px, py), excluding `self`. Returns the count;
  /// the indices are in `results[0..<count]` until the next query.
  @discardableResult
  public func query(_ px: Double, _ py: Double, _ radius: Double, _ selfIndex: Int,
                    _ x: [Float], _ y: [Float]) -> Int {
    var n = 0
    let r2 = radius * radius
    let reach = Swift.max(1, Int((radius / cellSize).rounded(.up)))
    let cx = Int(((px - minX) / cellSize).rounded(.down))
    let cy = Int(((py - minY) / cellSize).rounded(.down))

    var gy = cy - reach
    while gy <= cy + reach {
      defer { gy += 1 }
      if gy < 0 || gy >= rows { continue }
      var gx = cx - reach
      while gx <= cx + reach {
        defer { gx += 1 }
        if gx < 0 || gx >= cols { continue }
        let cell = gy * cols + gx
        var k = Int(cellStart[cell])
        let end = Int(cellStart[cell + 1])
        while k < end {
          defer { k += 1 }
          let j = Int(items[k])
          if j == selfIndex { continue }
          let dx = Double(x[j]) - px
          let dy = Double(y[j]) - py
          if dx * dx + dy * dy > r2 { continue }
          if n == results.count {
            results.append(contentsOf: [Int32](repeating: 0, count: results.count))
          }
          results[n] = Int32(j)
          n += 1
        }
      }
    }
    resultCount = n
    return n
  }

  private func cellOf(_ px: Double, _ py: Double) -> Int {
    let gx = Int(jsMin(Double(cols - 1), jsMax(0, ((px - minX) / cellSize).rounded(.down))))
    let gy = Int(jsMin(Double(rows - 1), jsMax(0, ((py - minY) / cellSize).rounded(.down))))
    return gy * cols + gx
  }
}
