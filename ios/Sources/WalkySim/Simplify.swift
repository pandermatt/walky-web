import Foundation

/// Ramer-Douglas-Peucker polyline simplification. Ports `src/sim/simplify.ts`.
///
/// A freehand stroke arrives as one point per pointer event -- hundreds for a
/// single shape. Vertex count is what the navigation pipeline costs scale on,
/// above all the O(n^2) visibility sweep over the corners those parts produce.
public func simplifyPolyline(_ points: [Point], _ tolerance: Double) -> [Point] {
  if points.count <= 2 || tolerance <= 0 { return points.map { Point($0.x, $0.y) } }

  var keep = [UInt8](repeating: 0, count: points.count)
  keep[0] = 1
  keep[points.count - 1] = 1

  // Explicit stack rather than recursion: a long stroke can be thousands of
  // points, and the worst case recurses once per point.
  var stack: [(Int, Int)] = [(0, points.count - 1)]
  while let (first, last) = stack.popLast() {
    var worst = 0.0
    var worstIndex = -1
    var i = first + 1
    while i < last {
      let d = pointSegmentDistance(points[first], points[last], points[i])
      if d > worst { worst = d; worstIndex = i }
      i += 1
    }
    if worstIndex >= 0 && worst > tolerance {
      keep[worstIndex] = 1
      stack.append((first, worstIndex))
      stack.append((worstIndex, last))
    }
  }

  var out: [Point] = []
  for i in 0..<points.count where keep[i] != 0 { out.append(Point(points[i].x, points[i].y)) }
  return out
}

/// Simplifies a closed outline.
///
/// A ring has no natural endpoints for RDP to anchor on, and anchoring at an
/// arbitrary index pins two neighbours that may sit mid-edge. Anchoring at the
/// two points furthest apart splits the ring into halves that each simplify
/// cleanly.
public func simplifyClosed(_ points: [Point], _ tolerance: Double) -> [Point] {
  if points.count <= 3 { return points.map { Point($0.x, $0.y) } }

  var a = 0
  var b = 0
  var best = -1.0
  for i in 0..<points.count {
    let dx = points[i].x - points[0].x, dy = points[i].y - points[0].y
    let d = dx * dx + dy * dy
    if d > best { best = d; b = i }
  }
  best = -1
  for i in 0..<points.count {
    let dx = points[i].x - points[b].x, dy = points[i].y - points[b].y
    let d = dx * dx + dy * dy
    if d > best { best = d; a = i }
  }
  if a == b { return points.map { Point($0.x, $0.y) } }

  let lo = min(a, b)
  let hi = max(a, b)
  let front = simplifyPolyline(Array(points[lo...hi]), tolerance)
  let back = simplifyPolyline(Array(points[hi...]) + Array(points[0...lo]), tolerance)
  // Both halves include the two anchors; drop the duplicates when rejoining.
  return front + back.dropFirst().dropLast()
}
