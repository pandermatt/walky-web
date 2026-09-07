import Foundation

/// How a pedestrian decides its next step. Ports `src/sim/behaviour.ts`.
///
/// The lattice is kept from `pedestrians/PedestrianBehaviour`; what the original
/// did with it does not survive. It asked one question -- "is anyone inside my
/// personal space?" -- and on a yes stopped navigating and moved solely to
/// relieve the crush, so widening the setting put more of the crowd permanently
/// in relief mode. Here a pedestrian scores all nine things it could do and
/// takes the cheapest, so it slows, sidesteps or waits but never stops heading
/// for its goal.
///
/// The full reasoning for every constant is in the TypeScript. This file keeps
/// the reasons that bear on *porting* it and points at the original for the rest.

/// The length of a diagonal step (`AbstractPedestrian.SQUARE_ROOT_OF_TWO`).
/// A literal, matching the original's truncated constant -- not `2.squareRoot()`.
public let SQRT2: Double = 1.41421356237

/// Weight of a neighbour directly behind against one directly ahead;
/// Helbing and Johansson fit ~0.2 to video of real crowds.
private let LAMBDA: Double = 0.2
private let DECAY_FRACTION: Double = 0.3
/// Extra weight for a neighbour bound somewhere other than here.
private let OPPOSING: Double = 2.5
/// Weight of a neighbour this pedestrian outranks. Having right of way makes you
/// less careful, not blind.
private let YIELD_LOW: Double = 0.25
private let W_SPACE: Double = 6
/// Priced above a whole step of progress: it is what separates walking from
/// jittering.
private let W_TURN: Double = 1.2
private let W_SIDE: Double = 0.15
private let W_WAIT: Double = 0.3
private let PATIENCE: Double = 10
private let LOOKAHEAD: Double = 4
private let HEADING_SMOOTH: Double = 0.35
private let PACE_SPREAD: Double = 0.15

/// A pedestrian's pace, as a multiple of the speed setting.
public func paceScale(_ trait: Double) -> Double { 1 + PACE_SPREAD * trait }

/// The room this one would keep if nobody were in the way.
public func wantedSpace(_ trait: Double, _ personalSpace: Double) -> Double {
  personalSpace * (1 - SPACE_SPREAD * trait)
}

private let CROWD_PACE_FLOOR: Double = 0.65
private let PACE_DECAY: Double = 0.22

/// What a pedestrian's pace comes to at a given amount of elbow room -- the
/// fundamental diagram from the other end. Flat until the crowd is genuinely a
/// crowd, which is the shape of the measured curve.
public func crowdPace(_ density: Double) -> Double {
  let over = density - FREE_NEIGHBOURS
  if over <= 0 { return 1 }
  return CROWD_PACE_FLOOR + (1 - CROWD_PACE_FLOOR) * jsExp(-PACE_DECAY * over)
}

private let SLOWDOWN_MAX: Double = 3

/// The same curve read the other way, for the router. Deliberately not
/// `1 / crowdPace`: a route planner asking "should I go round?" is asking about
/// the queue, not the shuffle.
public func crowdSlowdown(_ density: Double) -> Double {
  let over = density - FREE_NEIGHBOURS
  if over <= 0 { return 1 }
  return jsMin(SLOWDOWN_MAX, 1 + PACE_DECAY * over)
}

private let SPACE_SPREAD: Double = 0.2
private let DENSITY_HALF: Double = 3
private let COMPRESS_FLOOR: Double = 0.25
private let PRESSURE_HALF: Double = 6

/// How much of the crowd's regard it commands: 0.65 when polite, 1.35 when not.
private let NERVE_PRESENCE: Double = 0.2
/// What standing still costs it: 0.4x when polite, 1.6x when not.
private let NERVE_IMPATIENCE: Double = 1.2
/// How hard it leans on the person in front: 0.5x when polite, 1.5x when not.
private let NERVE_LEAN: Double = 1.0

/// How far a body will give when the crowd leans on it, as a fraction of its
/// radius. Nought below a threshold set above anything a walking crowd
/// produces, so being close to somebody never earns the right to walk into them.
public let SQUASH_MAX: Double = 0.15
private let SQUASH_HALF: Double = 4
private let SQUASH_ONSET: Double = 1.5
private let SHOVE_ONSET: Double = 0.25

private let BULLY_FROM: Double = 0.88
private let SHOVE_SQUEEZE: Double = 0.75

/// How much shove is in a pedestrian: nought for most, total at the very top.
private func shoveOf(_ assertiveness: Double) -> Double {
  jsMax(0, (assertiveness - BULLY_FROM) / (1 - BULLY_FROM))
}

private let DESPERATE_AFTER: Double = 180
private let DESPERATE_RAMP: Double = 240

/// How far past `DESPERATE_AFTER` this one is, 0 to 1: the ramp alone, with no
/// temperament in it. The gates that must not stay open for the naturally pushy
/// read this rather than `nerveOf`.
private func desperationOf(_ a: Agents, _ i: Int) -> Double {
  jsMin(1, jsMax(0, (Double(a.stalled[i]) - DESPERATE_AFTER) / DESPERATE_RAMP))
}

/// How bold this one is right now: its temperament, or its desperation if worse.
private func nerveOf(_ a: Agents, _ i: Int) -> Double {
  jsMax(Double(a.assertiveness[i]), desperationOf(a, i))
}

private let PIN_FLOOR: Double = 0.15

/// How much closer to the goal a tick has to get somebody before it counts as
/// progress rather than as being stuck.
public let STALL_PROGRESS: Double = 0.5

private let NUDGE_AFTER: Double = 12
private let NUDGE: Double = 0.45

private let W_WANDER: Double = 0.16
private let WANDER_X: Double = 0.031
private let WANDER_Y: Double = 0.017

/// A repeatable number in [0,1) from three integers.
///
/// `x | 0` in JS is `ToInt32` on a double, which `Int32(truncatingIfNeeded:)`
/// cannot express -- hence `toInt32`. The seed is written as a bit pattern
/// because `0x9e3779b9` exceeds Int32.max and JS reaches it by wrapping.
private func wobble(_ x: Double, _ y: Double, _ salt: Double) -> Double {
  var h = Int32(bitPattern: 0x9e3779b9) ^ imul(toInt32(x), 73856093)
    ^ imul(toInt32(y), 19349663) ^ imul(toInt32(salt), 83492791)
  h = imul(h ^ ushr(h, 15), Int32(bitPattern: 2246822519))
  h = imul(h ^ ushr(h, 13), Int32(bitPattern: 3266489917))
  h ^= ushr(h, 16)
  return Double(toUint32(h)) / 4294967296
}

/// Salts for every draw in the file, one per independent decision. Each is mixed
/// with `stalled` -- the one clock that keeps ticking for a pedestrian pinned in
/// place -- so a shove refused this tick is a different draw next tick.
private let CARRY_SALT: Double = 101
private let ESCAPE_DX_SALT: Double = 211
private let ESCAPE_DY_SALT: Double = 223
private let ESCAPE_X_SALT: Double = 227
private let ESCAPE_Y_SALT: Double = 229
private let RANDOM_DX_SALT: Double = 307
private let RANDOM_DY_SALT: Double = 311

/// The wobble of a pedestrian stuck for `stalled` ticks, keyed to where it stands.
private func stuckWobble(_ x: Double, _ y: Double, _ stalled: Double, _ salt: Double) -> Double {
  wobble(jsRound(x), jsRound(y), salt + stalled * 331)
}

private let CARRY_FROM: Double = 2.5
private let CARRY_WANDER: Double = 0.5

/// How much of its own weight a pedestrian can still put behind a lean.
private func gripOf(_ a: Agents, _ j: Int) -> Double {
  let p = Double(a.pressure[j])
  if p <= 0 { return 1 }
  let coherence = jsHypot(Double(a.pushX[j]), Double(a.pushY[j]))
  let blended = coherence + (1 - coherence) / (1 + p / PRESSURE_HALF)
  return PIN_FLOOR + (1 - PIN_FLOOR) * blended
}

private let W_PARTY: Double = 1.0
private let FORMATION: Double = 0.5

/// How much of its own load a pressed pedestrian passes to the one in front.
private let TRANSMIT: Double = 0.8
private let PRESSURE_MAX: Double = 40
private let FREE_NEIGHBOURS: Double = 2
private let DENSITY_WINDOW: Double = 3
/// The wider window pace is judged in. Wider than the density one, and it has to
/// be: a settled crowd sits outside arm's reach almost everywhere.
public let PACE_WINDOW: Double = 5

/// How far a pedestrian can be influenced from. The slack is not padding: the
/// hash is built once at the top of a tick and agents move within it.
public func interactionReach(_ radius: Double, _ personalSpace: Double, _ speed: Double) -> Double {
  2 * radius + personalSpace + LOOKAHEAD + jsMax(0, speed) * (1 + PACE_SPREAD)
}

public struct StepResult: Sendable {
  /// Distance covered this tick; 0 for a pedestrian that stood still.
  public var length: Double
  /// Whether the agent should re-plan its waypoint.
  public var replan: Bool
}

private let NO_STEP = StepResult(length: 0, replan: true)

private func stepLengthOf(_ dx: Double, _ dy: Double) -> Double {
  let both = abs(dx) + abs(dy)
  return both == 2 ? SQRT2 : both
}

public final class Behaviour {
  private let agents: Agents
  private let nav: Navigation
  private let hash: SpatialHash
  private let speed: Double

  public init(_ agents: Agents, _ nav: Navigation, _ hash: SpatialHash, _ speed: Double) {
    self.agents = agents
    self.nav = nav
    self.hash = hash
    self.speed = speed
  }

  /// Neighbours close enough that a step could overlap them.
  private var bodyIdx = [Int32](repeating: 0, count: 64)
  private var bodyCount = 0
  /// Total penetration where the pedestrian stands now; the "no worse" baseline.
  private var hereOverlap: Double = 0
  /// The deepest single pair here, and at the candidate last measured.
  private var hereWorst: Double = 0
  private var worstThere: Double = 0
  /// Which way discomfort increases, and how steeply.
  private var gradX: Double = 0
  private var gradY: Double = 0
  /// How much oncoming traffic there is to pass.
  private var oncoming: Double = 0
  /// How far this pedestrian's body will give at its current load.
  private var squash: Double = 0

  /// Everything about the neighbourhood that does not depend on which way the
  /// pedestrian steps, in one pass.
  ///
  /// The discomfort field is summarised by its *gradient* rather than sampled
  /// per candidate: a candidate is at most one tick's travel away against a
  /// falloff length of a dozen or more, so the first-order term is nearly the
  /// whole story and the constant part cancels out of the comparison. That
  /// turns nine passes over the neighbours into one.
  private func survey(_ selfIndex: Int, _ radius: Double, _ personalSpace: Double) {
    let a = agents
    let reach = interactionReach(radius, personalSpace, speed)
    let n = hash.query(Double(a.x[selfIndex]), Double(a.y[selfIndex]), reach, selfIndex, a.x, a.y)
    let found = hash.results
    if bodyIdx.count < n { bodyIdx = [Int32](repeating: 0, count: n * 2) }

    let load0 = Double(a.pressure[selfIndex])
    let shove = shoveOf(nerveOf(a, selfIndex))
    let pressed = 1 / (1 + load0 / PRESSURE_HALF)
    let squashHalf = SQUASH_HALF * (1 - SHOVE_SQUEEZE * shove)
    // A pushy one starts putting a shoulder in at a lighter crush than anybody
    // else -- but not a lighter one than a calm crowd ever reaches.
    let crushed = jsMax(0, load0 - SQUASH_ONSET * (1 - SHOVE_ONSET * shove))
    squash = SQUASH_MAX * radius * (crushed / (crushed + squashHalf))
    let densityWindow2 = (DENSITY_WINDOW * radius) * (DENSITY_WINDOW * radius)
    let paceWindow2 = (PACE_WINDOW * radius) * (PACE_WINDOW * radius)
    var crowd: Double = 0
    var about: Double = 0
    for k in 0..<n {
      let j = Int(found[k])
      if a.arrived[j] != 0 { continue }
      let cx = Double(a.x[j]) - Double(a.x[selfIndex])
      let cy = Double(a.y[j]) - Double(a.y[selfIndex])
      let c2 = cx * cx + cy * cy
      if c2 < densityWindow2 { crowd += 1 }
      if c2 < paceWindow2 { about += 1 }
    }
    let compression = jsMax(
      COMPRESS_FLOOR,
      1 / (1 + jsMax(0, crowd - FREE_NEIGHBOURS) / DENSITY_HALF))
    let wanted = wantedSpace(Double(a.trait[selfIndex]), personalSpace)
    let space = wanted * jsMax(COMPRESS_FLOOR, jsMin(compression, pressed))
    // Being shoved from behind makes you tolerate the back of the person in
    // front. It does not make you willing to walk into somebody coming the other
    // way. Without this split, pressure quietly dismantles lane formation.
    let desperation = desperationOf(a, selfIndex)
    let open = wanted * compression
    let openSpace = open + (space - open) * desperation
    a.effectiveSpace[selfIndex] = Float(space)
    a.density[selfIndex] = Float(about)
    let bubble = 2 * radius + space
    let decay = jsMax(1, DECAY_FRACTION * bubble)
    let openBubble = 2 * radius + openSpace
    let openDecay = jsMax(1, DECAY_FRACTION * openBubble)

    let hx = Double(a.headingX[selfIndex])
    let hy = Double(a.headingY[selfIndex])
    let facing = hx != 0 || hy != 0
    let contact = 2 * radius
    let bodyReach = contact + jsMin(speed * (1 + PACE_SPREAD), contact) + 1
    let goalSelf = a.goal[selfIndex]
    let costSelf = Double(a.costToGoal[selfIndex])
    let opposing = OPPOSING + (1 - OPPOSING) * desperation

    var bodies = 0
    var load: Double = 0
    var loadRaw: Double = 0
    var carried: Double = 0
    var pushX: Double = 0
    var pushY: Double = 0
    var gx: Double = 0
    var gy: Double = 0
    var px2: Double = 0
    var py2: Double = 0
    var companions: Double = 0
    let party = a.party[selfIndex]
    let formation = 2 * radius + FORMATION * personalSpace
    var oncomingSum: Double = 0
    var here: Double = 0
    var worst: Double = 0

    for k in 0..<n {
      let j = Int(found[k])
      if a.arrived[j] != 0 { continue }

      let trueX = Double(a.x[j]) - Double(a.x[selfIndex])
      let trueY = Double(a.y[j]) - Double(a.y[selfIndex])
      let trueD = jsHypot(trueX, trueY)

      // Bodies, at their real positions: this is what may not be walked into.
      if trueD < bodyReach {
        bodyIdx[bodies] = Int32(j)
        bodies += 1
        if trueD < contact {
          let into = contact - trueD
          here += into
          if into > worst { worst = into }
        }
      }

      // Everything else judges the neighbour where it is about to be. One
      // displacement along its heading is the whole of anticipation.
      let rx = trueX + Double(a.headingX[j]) * LOOKAHEAD
      let ry = trueY + Double(a.headingY[j]) * LOOKAHEAD
      let d = jsHypot(rx, ry)
      let sameGoal = a.goal[j] == goalSelf
      let reachJ = sameGoal ? bubble : openBubble
      let decayJ = sameGoal ? decay : openDecay
      if d < 1e-6 || d >= reachJ { continue }

      var w = costSelf < Double(a.costToGoal[j]) ? YIELD_LOW : 1
      if !sameGoal { w *= opposing }
      // Somebody walking at you like they mean it is somebody you give way to.
      w *= 1 - NERVE_PRESENCE / 2 + NERVE_PRESENCE * nerveOf(a, j)

      let ux = rx / d
      let uy = ry / d
      if facing {
        // Anisotropy, taken against the heading rather than against each
        // candidate -- which keeps this loop candidate-free, and is truer
        // anyway, since a pedestrian's sense of its own front turns as
        // gradually as it does.
        let cos = ux * hx + uy * hy
        w *= LAMBDA + (1 - LAMBDA) * (1 + cos) / 2
        if cos > 0.5 {
          let closing = -(Double(a.headingX[j]) * hx + Double(a.headingY[j]) * hy)
          if closing > 0 { oncomingSum += closing }
        }
      }

      let e = jsExp((reachJ - d) / decayJ)
      let scale = W_SPACE * w * e / decayJ
      gx += scale * ux
      gy += scale * uy

      // Keeping up with whoever you came in with.
      if party >= 0 && sameGoal && a.party[j] == party && trueD > formation {
        let pull = jsMin(1, (trueD - formation) / formation)
        px2 += pull * (trueX / trueD)
        py2 += pull * (trueY / trueD)
        companions += 1
      }

      // Is this one leaning on us? Only somebody held up counts.
      if Double(a.waited[j]) <= 0 { continue }
      let wantX = a.hasWaypoint[j] != 0 ? Double(a.waypointX[j]) - Double(a.x[j]) : Double(a.headingX[j])
      let wantY = a.hasWaypoint[j] != 0 ? Double(a.waypointY[j]) - Double(a.y[j]) : Double(a.headingY[j])
      let wantLen = jsHypot(wantX, wantY)
      if wantLen < 1e-6 { continue }
      let into = -(ux * wantX + uy * wantY) / wantLen
      if into <= 0 { continue }
      let share = into * (1 - d / reachJ)
        * (1 - NERVE_LEAN / 2 + NERVE_LEAN * nerveOf(a, j))
      let put = share * gripOf(a, j)
      loadRaw += share
      load += put
      // The raw share, deliberately: what the back of the crowd is doing has to
      // reach the front whether or not the people between can still push.
      carried += share * Double(a.pressure[j])
      pushX -= put * ux
      pushY -= put * uy
    }

    // Its own load, plus the mean of what its pushers are already carrying. The
    // mean rather than the sum is what keeps a deep crowd bounded.
    a.pressure[selfIndex] = loadRaw <= 0
      ? 0
      : Float(jsMin(PRESSURE_MAX, load + TRANSMIT * (carried / loadRaw)))
    // Divided by the total load rather than normalised: the length that comes
    // out is how much of the load points anywhere.
    a.pushX[selfIndex] = loadRaw > 0 ? Float(pushX / loadRaw) : 0
    a.pushY[selfIndex] = loadRaw > 0 ? Float(pushY / loadRaw) : 0

    if companions > 0 {
      gx -= W_PARTY * px2 / companions
      gy -= W_PARTY * py2 / companions
    }

    bodyCount = bodies
    hereOverlap = here
    hereWorst = worst
    gradX = gx
    gradY = gy
    oncoming = oncomingSum
  }

  /// A coordinate is legal when it is clear of every wall and does not put this
  /// pedestrian on top of another.
  ///
  /// "No worse than now" rather than "none at all": strict non-overlap deadlocks
  /// any crowd already packed tighter than two radii, and that state is
  /// reachable in normal use.
  public func isLegal(_ px: Double, _ py: Double, _ radius: Double) -> Bool {
    if insideAnyWall(Point(px, py)) { return false }
    let there = agentOverlap(px, py, radius)
    if there == 0 { return true }
    // Working loose is never refused.
    if there < hereOverlap { return true }
    // Squeezing in is capped per *pair*, not on the total: a move that gathers
    // the same total onto one neighbour drives one body much deeper.
    if worstThere > jsMax(squash, hereWorst) { return false }
    return there <= squash
  }

  /// Total penetration into other pedestrians at a position; 0 when clear.
  private func agentOverlap(_ px: Double, _ py: Double, _ radius: Double) -> Double {
    let a = agents
    let minD = radius * 2
    var total: Double = 0
    var worst: Double = 0
    for k in 0..<bodyCount {
      let j = Int(bodyIdx[k])
      let d = jsHypot(Double(a.x[j]) - px, Double(a.y[j]) - py)
      if d < minD { let into = minD - d; total += into; if into > worst { worst = into } }
    }
    worstThere = worst
    return total
  }

  /// One substep towards `target`: score all nine options and take the cheapest.
  ///
  /// The directions are the lattice's eight, but the move along the winner is
  /// `len` -- at most a pixel -- so positions are continuous even though the
  /// search is discrete. Every cost is per unit of distance, which is what makes
  /// the same comparison valid at any length.
  public func stepTowards(_ i: Int, _ target: Point, _ radius: Double,
                          _ personalSpace: Double, _ len: Double) -> StepResult {
    let a = agents
    let x = Double(a.x[i])
    let y = Double(a.y[i])

    survey(i, radius, personalSpace)

    let distHere = jsHypot(target.x - x, target.y - y)
    // Land on the waypoint rather than orbit it.
    let step = jsMin(jsMax(len, 0), jsMax(distHere, 1e-3))
    let hx = Double(a.headingX[i])
    let hy = Double(a.headingY[i])
    let facing = hx != 0 || hy != 0
    // The right hand of a pedestrian facing h. Screen y runs down, so walking
    // east that is south.
    let rightX = -hy
    let rightY = hx
    let stalled = Double(a.stalled[i])
    let restless = stalled > NUDGE_AFTER
      ? NUDGE * jsMin(1, (stalled - NUDGE_AFTER) / NUDGE_AFTER)
      : 0
    // And nobody walks a ruler line.
    let wander = W_WANDER * jsSin(x * WANDER_X + y * WANDER_Y + Double(a.trait[i]) * 6.283)

    // Everything is priced per unit of distance travelled, which is what makes a
    // shallow approach angle come out as weaving. Analytic in the direction, so
    // the same pricing answers about any angle.
    func priceDir(_ ux: Double, _ uy: Double) -> Double {
      let nx = x + ux * step
      let ny = y + uy * step
      let gain = distHere - jsHypot(target.x - nx, target.y - ny)
      var cost = -gain / step + gradX * ux + gradY * uy
      if facing {
        cost += W_TURN * (1 - (ux * hx + uy * hy)) / 2
        if oncoming > 0 {
          cost -= W_SIDE * oncoming * (ux * rightX + uy * rightY)
        }
        cost -= wander * (ux * rightX + uy * rightY)
      }
      return cost
    }

    // Standing still is always on the table -- the option the original lacked,
    // which is why a blocked pedestrian there could only jiggle. It is also the
    // reference every other candidate is measured against, so it carries no
    // discomfort term of its own.
    var bestCost = W_WAIT
      * (1 - NERVE_IMPATIENCE / 2 + NERVE_IMPATIENCE * nerveOf(a, i))
      * (1 + Double(a.waited[i]) / PATIENCE)
    var bestX: Double = 0
    var bestY: Double = 0
    var bestUx: Double = 0
    var bestUy: Double = 0
    var moved = false

    for dy in -1...1 {
      for dx in -1...1 {
        let norm = stepLengthOf(Double(dx), Double(dy))
        if norm == 0 { continue }

        let ux = Double(dx) / norm
        let uy = Double(dy) / norm
        let nx = x + ux * step
        let ny = y + uy * step
        if !isLegal(nx, ny, radius) { continue }

        var cost = priceDir(ux, uy)
        if restless > 0 {
          cost += restless * (wobble(
            jsRound(x), jsRound(y), Double((dx + 1) * 3 + (dy + 1)) + stalled * 9
          ) - 0.5)
        }

        if cost < bestCost {
          bestCost = cost
          bestX = nx
          bestY = ny
          bestUx = ux
          bestUy = uy
          moved = true
        }
      }
    }

    // The eight-way scan finds the right spoke; the true best direction is
    // usually between two of them. Price the winner's two angular neighbours
    // halfway to the next spokes and slide to the minimum of the parabola
    // through the three. Skipped while the fidget is on: its per-spoke wobble is
    // doing the opposite job.
    if moved && restless <= 0 {
      let spoke = Double.pi / 8
      let angle = jsAtan2(bestUy, bestUx)
      let low = priceDir(jsCos(angle - spoke), jsSin(angle - spoke))
      let high = priceDir(jsCos(angle + spoke), jsSin(angle + spoke))
      let curve = low - 2 * bestCost + high
      if curve > 1e-9 {
        let off = jsMax(-spoke, jsMin(spoke, (spoke * (low - high)) / (2 * curve)))
        if off != 0 {
          let ux = jsCos(angle + off)
          let uy = jsSin(angle + off)
          let nx = x + ux * step
          let ny = y + uy * step
          if isLegal(nx, ny, radius) { bestX = nx; bestY = ny }
        }
      }
    }

    if !moved {
      // Standing still is only available to somebody the crowd will let stand.
      _ = carryStep(i, radius, step)
      // Waiting, rather than being unable to move: the waypoint is still good.
      a.waited[i] = Float(Double(a.waited[i]) + 1)
      return StepResult(length: 0, replan: false)
    }
    return commit(i, Point(bestX, bestY), step, true)
  }

  /// Being moved by the crowd rather than by choice.
  ///
  /// Past `CARRY_FROM` a pedestrian no longer gets to decide it is staying put.
  /// It deliberately leaves its patience alone: it is still stuck, only
  /// somewhere else now.
  @discardableResult
  private func carryStep(_ i: Int, _ radius: Double, _ len: Double) -> Bool {
    let a = agents
    let px = Double(a.pushX[i])
    let py = Double(a.pushY[i])
    let load = Double(a.pressure[i]) * jsHypot(px, py)
    if load < CARRY_FROM { return false }

    // A shove in a crush does not travel in a straight line.
    let swing = stuckWobble(Double(a.x[i]), Double(a.y[i]), Double(a.stalled[i]), CARRY_SALT) * 2 - 1
    let wander = CARRY_WANDER * jsMin(1, load / PRESSURE_MAX) * swing
    let cos = jsCos(wander)
    let sin = jsSin(wander)
    let wx = px * cos - py * sin
    let wy = px * sin + py * cos

    let wlen = jsHypot(wx, wy)
    if wlen < 1e-6 { return false }
    let carry = jsMin(1, len)
    if carry <= 0 { return false }
    let nx = Double(a.x[i]) + (wx / wlen) * carry
    let ny = Double(a.y[i]) + (wy / wlen) * carry
    if !isLegal(nx, ny, radius) { return false }
    // Deliberately not through `commit`. Patience must keep counting -- it is
    // what tells everybody else this one is held up -- and the heading must not
    // follow: somebody shoved sideways is not facing sideways.
    a.x[i] = Float(nx)
    a.y[i] = Float(ny)
    a.carries += 1
    return true
  }

  /// How far inside a wall's expanded hull this point sits: 0 when clear.
  private func penetration(_ p: Point) -> Double {
    var worst: Double = 0
    for ob in nav.obstacles {
      if !inShell(p, ob.wallId) { continue }
      if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
        || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { continue }
      if !pointInPolygon(ob.hull, p) { continue }
      worst = jsMax(worst, distanceOut(p, ob))
    }
    return worst
  }

  /// Broad phase: a point outside a wall's hull cannot be inside any of its parts.
  private func inShell(_ p: Point, _ wallId: Int) -> Bool {
    for shell in nav.shells {
      if shell.wallId != wallId { continue }
      if p.x < shell.bbox.minX || p.x > shell.bbox.maxX
        || p.y < shell.bbox.minY || p.y > shell.bbox.maxY { return false }
      return pointInPolygon(shell.hull, p)
    }
    return true
  }

  private func insideAnyWall(_ p: Point) -> Bool {
    for ob in nav.obstacles {
      if !inShell(p, ob.wallId) { continue }
      if p.x < ob.bbox.minX || p.x > ob.bbox.maxX
        || p.y < ob.bbox.minY || p.y > ob.bbox.maxY { continue }
      if pointInPolygon(ob.hull, p) { return true }
    }
    return false
  }

  /// Distance from an interior point to the nearest point on the hull outline.
  private func distanceOut(_ p: Point, _ ob: Obstacle) -> Double {
    var best = Double.infinity
    let h = ob.hull
    let n = h.count
    for i in 0..<n {
      best = jsMin(best, distance(p, closestPointOnSegment(h[i], h[(i + 1) % n], p)))
    }
    return best
  }

  /// The outward direction from an interior point.
  private func outwardFrom(_ p: Point) -> Point? {
    var best: Point?
    var bestDist = Double.infinity
    for ob in nav.obstacles {
      if !pointInPolygon(ob.hull, p) { continue }
      let h = ob.hull
      let n = h.count
      for i in 0..<n {
        let q = closestPointOnSegment(h[i], h[(i + 1) % n], p)
        let d = distance(p, q)
        if d < bestDist { bestDist = d; best = q }
      }
    }
    return best
  }

  /// What a pedestrian does when it has no route at all: jiggle until it finds
  /// one. Either it is embedded in a wall's expanded hull and works its way out,
  /// or the goal is genuinely unreachable and it fidgets in place.
  public func escapeStep(_ i: Int, _ radius: Double, _ personalSpace: Double) -> StepResult {
    let a = agents
    let here = Point(Double(a.x[i]), Double(a.y[i]))
    let depth = penetration(here)

    if depth == 0 { return randomStep(i, radius, personalSpace) }

    // Head for the nearest way out, with a hashed tie-break so a pedestrian
    // pinned exactly on an axis still works itself loose.
    let stuck = Double(a.stalled[i])
    let target = outwardFrom(here)
    var dx: Double = 0
    var dy: Double = 0
    if let t = target {
      dx = jsSign(jsRound(t.x - here.x))
      dy = jsSign(jsRound(t.y - here.y))
    }
    if dx == 0 && dy == 0 {
      dx = (stuckWobble(here.x, here.y, stuck, ESCAPE_DX_SALT) * 3).rounded(.down) - 1
      dy = (stuckWobble(here.x, here.y, stuck, ESCAPE_DY_SALT) * 3).rounded(.down) - 1
    }

    let candidates: [Point] = [
      Point(here.x + dx, here.y + dy),
      Point(here.x + dx, here.y),
      Point(here.x, here.y + dy),
      Point(here.x + (stuckWobble(here.x, here.y, stuck, ESCAPE_X_SALT) < 0.5 ? 1 : -1), here.y),
      Point(here.x, here.y + (stuckWobble(here.x, here.y, stuck, ESCAPE_Y_SALT) < 0.5 ? 1 : -1)),
    ]

    for c in candidates {
      if c.x == here.x && c.y == here.y { continue }
      // Accept anything that gets us out, or at least less deeply in.
      if penetration(c) < depth {
        return commit(i, c, stepLengthOf(c.x - here.x, c.y - here.y), true)
      }
    }
    return NO_STEP
  }

  /// Last resort when there is nowhere sensible to go.
  public func randomStep(_ i: Int, _ radius: Double, _ personalSpace: Double) -> StepResult {
    let a = agents
    let sx = Double(a.x[i]), sy = Double(a.y[i]), st = Double(a.stalled[i])
    let dx = (stuckWobble(sx, sy, st, RANDOM_DX_SALT) * 3).rounded(.down) - 1
    let dy = (stuckWobble(sx, sy, st, RANDOM_DY_SALT) * 3).rounded(.down) - 1
    if dx == 0 && dy == 0 { return NO_STEP }
    let nx = sx + dx
    let ny = sy + dy
    survey(i, radius, personalSpace)
    if !isLegal(nx, ny, radius) { return NO_STEP }
    return commit(i, Point(nx, ny), stepLengthOf(dx, dy), true)
  }

  private func commit(_ i: Int, _ to: Point, _ length: Double, _ replan: Bool) -> StepResult {
    let a = agents
    let dx = to.x - Double(a.x[i])
    let dy = to.y - Double(a.y[i])
    a.x[i] = Float(to.x)
    a.y[i] = Float(to.y)
    a.waited[i] = 0

    // Follow the steps actually taken, so the heading survives a sidestep
    // without swinging to meet it. The smoothing was tuned per pixel of travel
    // back when every step was one, so it is applied per pixel still.
    let alpha = 1 - jsPow(1 - HEADING_SMOOTH, length)
    let hx = Double(a.headingX[i]) + (dx / length - Double(a.headingX[i])) * alpha
    let hy = Double(a.headingY[i]) + (dy / length - Double(a.headingY[i])) * alpha
    let mag = jsHypot(hx, hy)
    if mag > 1e-6 { a.headingX[i] = Float(hx / mag); a.headingY[i] = Float(hy / mag) }

    return StepResult(length: length, replan: replan)
  }
}

/// `Math.sign`, which returns -0 for -0 and 0 for 0.
@inline(__always)
func jsSign(_ x: Double) -> Double {
  if x.isNaN { return .nan }
  if x > 0 { return 1 }
  if x < 0 { return -1 }
  return x
}
