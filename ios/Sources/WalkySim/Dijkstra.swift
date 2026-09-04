import Foundation

/// Dijkstra over a static graph in CSR form, on a 4-ary heap with lazy deletion.
/// Ports `src/sim/dijkstra.ts`.
///
/// **R1 lives here.** `dist`, `weights` and the heap's `keys` are all
/// `Float32Array` in JS, but `dist[u] + graph.weights[e]` is a *double* add --
/// reading a Float32Array widens. Port that as Swift `Float` arithmetic and the
/// sum rounds at every step, which flips comparisons at ties, which picks a
/// different predecessor, which routes the whole crowd somewhere else. Storage
/// is `Float`; arithmetic is `Double`. Always.
public struct CsrGraph {
  public var nodeCount: Int
  public var offsets: [Int32]
  public var targets: [Int32]
  public var weights: [Float]

  public init(nodeCount: Int, offsets: [Int32], targets: [Int32], weights: [Float]) {
    self.nodeCount = nodeCount
    self.offsets = offsets
    self.targets = targets
    self.weights = weights
  }
}

private struct QuadHeap {
  private var nodes: [Int32]
  private var keys: [Float]
  private(set) var size = 0

  init(capacity: Int) {
    nodes = [Int32](repeating: 0, count: capacity)
    keys = [Float](repeating: 0, count: capacity)
  }

  mutating func push(_ node: Int32, _ key: Double) {
    if size == nodes.count { grow() }
    var i = size
    size += 1
    nodes[i] = node
    keys[i] = Float(key)
    while i > 0 {
      let parent = (i - 1) >> 2
      if Double(keys[parent]) <= Double(keys[i]) { break }
      swap(i, parent)
      i = parent
    }
  }

  /// The node with the smallest key, or -1 when empty.
  mutating func pop() -> Int32 {
    if size == 0 { return -1 }
    let top = nodes[0]
    size -= 1
    if size > 0 {
      nodes[0] = nodes[size]
      keys[0] = keys[size]
      siftDown(0)
    }
    return top
  }

  func peekKey() -> Double { Double(keys[0]) }

  private mutating func siftDown(_ start: Int) {
    var i = start
    while true {
      let first = 4 * i + 1
      if first >= size { break }
      // Pick the smallest of up to four children in one pass.
      var best = first
      let last = Swift.min(first + 4, size)
      var c = first + 1
      while c < last {
        if Double(keys[c]) < Double(keys[best]) { best = c }
        c += 1
      }
      if Double(keys[i]) <= Double(keys[best]) { break }
      swap(i, best)
      i = best
    }
  }

  private mutating func swap(_ a: Int, _ b: Int) {
    let n = nodes[a]; nodes[a] = nodes[b]; nodes[b] = n
    let k = keys[a]; keys[a] = keys[b]; keys[b] = k
  }

  private mutating func grow() {
    nodes.append(contentsOf: [Int32](repeating: 0, count: nodes.count))
    keys.append(contentsOf: [Float](repeating: 0, count: keys.count))
  }
}

public struct DijkstraResult {
  /// Cost from the nearest source; infinity where unreachable.
  public var dist: [Float]
  /// Predecessor on the best path, or -1 at a source / unreachable node.
  public var prev: [Int32]
}

/// Multi-source Dijkstra. Seeding every perimeter node of a goal at distance 0
/// makes one run answer "how far to this goal" for the whole graph.
public func dijkstra(_ graph: CsrGraph, _ sources: [Int]) -> DijkstraResult {
  let n = graph.nodeCount
  var dist = [Float](repeating: .infinity, count: n)
  var prev = [Int32](repeating: -1, count: n)
  var settled = [UInt8](repeating: 0, count: n)
  var heap = QuadHeap(capacity: Swift.max(16, n))

  for s in sources {
    if s < 0 || s >= n { continue }
    if dist[s] != 0 { dist[s] = 0; heap.push(Int32(s), 0) }
  }

  while heap.size > 0 {
    let key = heap.peekKey()
    let popped = heap.pop()
    if popped < 0 { break }
    let u = Int(popped)
    // Lazy deletion: a stale duplicate is one whose key no longer matches.
    if settled[u] != 0 || key > Double(dist[u]) { continue }
    settled[u] = 1

    let start = Int(graph.offsets[u])
    let end = Int(graph.offsets[u + 1])
    for e in start..<end {
      let v = Int(graph.targets[e])
      if settled[v] != 0 { continue }
      // The double add. See the note at the top of this file.
      let cand = Double(dist[u]) + Double(graph.weights[e])
      if cand < Double(dist[v]) {
        dist[v] = Float(cand)
        prev[v] = Int32(u)
        heap.push(Int32(v), cand)
      }
    }
  }

  return DijkstraResult(dist: dist, prev: prev)
}

/// Walks `prev` back from a node to its source, nearest-first.
public func pathFrom(_ result: DijkstraResult, _ node: Int) -> [Int] {
  var out: [Int] = []
  var at = node
  while at != -1 {
    out.append(at)
    if out.count > result.prev.count { break }   // defensive against a cycle
    at = Int(result.prev[at])
  }
  return out
}
