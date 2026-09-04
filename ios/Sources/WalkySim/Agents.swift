import Foundation

/// Agent state as a structure of arrays. Ports `src/sim/agents.ts`.
///
/// Every float field is `Float` storage read and written as `Double` -- see
/// JSMath.swift for why that is not a style choice.
public final class Agents {
  public var x: [Float]
  public var y: [Float]
  public var originX: [Float]
  public var originY: [Float]
  /// Goal wall id, or -1 when unassigned.
  public var goal: [Int32]
  /// Packed RGB, one byte per channel.
  public var color: [UInt32]
  public var arrived: [UInt8]
  public var waypointX: [Float]
  public var waypointY: [Float]
  public var hasWaypoint: [UInt8]
  /// Graph node the waypoint came from, or -1 when heading straight to the goal.
  public var waypointNode: [Int32]
  /// Smoothed unit direction of travel: the only memory the lattice keeps of
  /// which way a pedestrian was going. Zero until the first step.
  public var headingX: [Float]
  public var headingY: [Float]
  /// Consecutive steps spent standing still; patience that runs out.
  public var waited: [Float]
  /// Ticks spent getting no closer to the goal, whether or not anybody moved.
  public var stalled: [Float]
  /// How hard the crowd behind is pressing. The one genuinely physical quantity
  /// in the model -- everything else is a pedestrian deciding something.
  public var pressure: [Float]
  /// Which way the crowd is leaning, as a unit vector.
  public var pushX: [Float]
  public var pushY: [Float]
  /// How many others were within arm's reach at the last step.
  public var density: [Float]
  /// How far this pedestrian actually got last tick, in pixels.
  public var stepDist: [Float]
  /// A stable number in [0,1) making this one slightly its own person.
  public var trait: [Float]
  /// Where this one sits between giving way and getting on with it.
  public var assertiveness: [Float]
  /// Who this one came onto the map with, or -1 for somebody walking alone.
  public var party: [Int32]
  /// The room this one actually kept last step.
  public var effectiveSpace: [Float]
  /// Remaining distance to the goal; lower means higher priority in a crowd.
  public var costToGoal: [Float]
  public var selected: [UInt8]
  /// Came out of a generator, so is taken off the map the moment it arrives.
  public var spawned: [UInt8]

  /// Indices that crossed into `arrived` during the most recent `step`.
  public private(set) var justArrived: [Int] = []
  /// Involuntary steps taken this tick -- pedestrians the crowd moved.
  public var carries = 0
  public private(set) var count = 0
  private var capacity: Int

  public init(_ capacity: Int = 4096) {
    self.capacity = capacity
    x = [Float](repeating: 0, count: capacity)
    y = [Float](repeating: 0, count: capacity)
    originX = [Float](repeating: 0, count: capacity)
    originY = [Float](repeating: 0, count: capacity)
    goal = [Int32](repeating: 0, count: capacity)
    color = [UInt32](repeating: 0, count: capacity)
    arrived = [UInt8](repeating: 0, count: capacity)
    waypointX = [Float](repeating: 0, count: capacity)
    waypointY = [Float](repeating: 0, count: capacity)
    hasWaypoint = [UInt8](repeating: 0, count: capacity)
    waypointNode = [Int32](repeating: -1, count: capacity)
    headingX = [Float](repeating: 0, count: capacity)
    headingY = [Float](repeating: 0, count: capacity)
    waited = [Float](repeating: 0, count: capacity)
    stalled = [Float](repeating: 0, count: capacity)
    pressure = [Float](repeating: 0, count: capacity)
    pushX = [Float](repeating: 0, count: capacity)
    pushY = [Float](repeating: 0, count: capacity)
    density = [Float](repeating: 0, count: capacity)
    stepDist = [Float](repeating: 0, count: capacity)
    trait = [Float](repeating: 0, count: capacity)
    assertiveness = [Float](repeating: 0, count: capacity)
    party = [Int32](repeating: 0, count: capacity)
    effectiveSpace = [Float](repeating: 0, count: capacity)
    costToGoal = [Float](repeating: .infinity, count: capacity)
    selected = [UInt8](repeating: 0, count: capacity)
    spawned = [UInt8](repeating: 0, count: capacity)
  }

  /// Adds a pedestrian. The colour is required here where JS defaults it to
  /// `randomBrightColor()` -- the one place `Math.random` reaches into the
  /// model. Making it explicit means a caller cannot accidentally introduce
  /// nondeterminism the way the default argument does.
  @discardableResult
  public func add(_ at: Point, _ rgb: RGB) -> Int {
    if count == capacity { grow() }
    let i = count
    count += 1
    x[i] = Float(at.x); y[i] = Float(at.y)
    originX[i] = Float(at.x); originY[i] = Float(at.y)
    goal[i] = -1
    color[i] = packRgb(rgb)
    arrived[i] = 0
    hasWaypoint[i] = 0
    waypointNode[i] = -1
    headingX[i] = 0; headingY[i] = 0
    waited[i] = 0
    stalled[i] = 0
    pressure[i] = 0
    pushX[i] = 0; pushY[i] = 0
    density[i] = 0
    stepDist[i] = 0
    trait[i] = Float(traitOf(at.x, at.y, SPACE_SEED))
    assertiveness[i] = Float(traitOf(at.x, at.y, NERVE_SEED))
    party[i] = Int32(partyOf(at.x, at.y))
    effectiveSpace[i] = 0
    costToGoal[i] = .infinity
    selected[i] = 0
    spawned[i] = 0
    return i
  }

  @discardableResult
  public func addSpawned(_ at: Point, _ goalId: Int, _ rgb: RGB) -> Int {
    let i = add(at, rgb)
    goal[i] = Int32(goalId)
    spawned[i] = 1
    return i
  }

  public func setGoal(_ i: Int, _ wallId: Int, _ rgb: RGB) {
    goal[i] = Int32(wallId)
    color[i] = packRgb(rgb)
    arrived[i] = 0
    hasWaypoint[i] = 0
    costToGoal[i] = .infinity
  }

  /// Removes one agent by swapping the last into its slot. Order is not
  /// meaningful -- nothing holds an index across ticks.
  public func removeAt(_ i: Int) {
    count -= 1
    let last = count
    if i == last { return }
    x[i] = x[last]; y[i] = y[last]
    originX[i] = originX[last]; originY[i] = originY[last]
    goal[i] = goal[last]
    color[i] = color[last]
    arrived[i] = arrived[last]
    waypointX[i] = waypointX[last]; waypointY[i] = waypointY[last]
    hasWaypoint[i] = hasWaypoint[last]
    waypointNode[i] = waypointNode[last]
    headingX[i] = headingX[last]; headingY[i] = headingY[last]
    waited[i] = waited[last]
    stalled[i] = stalled[last]
    pressure[i] = pressure[last]
    pushX[i] = pushX[last]; pushY[i] = pushY[last]
    density[i] = density[last]
    stepDist[i] = stepDist[last]
    trait[i] = trait[last]
    assertiveness[i] = assertiveness[last]
    party[i] = party[last]
    effectiveSpace[i] = effectiveSpace[last]
    costToGoal[i] = costToGoal[last]
    selected[i] = selected[last]
    spawned[i] = spawned[last]
  }

  /// Advance every agent one tick.
  ///
  /// Mirrors `IntelligentPedestrian.makeStep`: top up the speed counter, then
  /// spend it on whole lattice steps until it runs out or the agent stops. A
  /// pedestrian that chooses to stand still ends its tick with budget in hand,
  /// which the cap takes back -- waiting must not bank into a lurch.
  public func step(_ nav: Navigation, _ hash: SpatialHash,
                   _ speed: Double, _ radius: Double, _ personalSpace: Double) {
    justArrived.removeAll(keepingCapacity: true)
    for i in 0..<count { stepDist[i] = 0 }
    hash.build(x, y, count, jsMax(1, interactionReach(radius, personalSpace, speed)))
    let behaviour = Behaviour(self, nav, hash, speed)

    for i in 0..<count {
      if arrived[i] != 0 { continue }
      let goalId = Int(goal[i])
      if goalId < 0 || !nav.hasGoal(goalId) { continue }

      let here = Point(Double(x[i]), Double(y[i]))
      if nav.hasArrived(here, goalId, radius + 1) {
        markArrived(i)
        continue
      }

      // What the tick is judged against: `costToGoal` is rewritten whenever a
      // waypoint is fetched, so comparing it across the tick asks "did this one
      // get closer" rather than "did it move" -- which a pedestrian shuffling on
      // the spot answers yes to.
      let costBefore = Double(costToGoal[i])

      let own = speed * paceScale(Double(trait[i])) * crowdPace(Double(density[i]))

      var left = own
      var stepTaken = true
      while left > 1e-6 && stepTaken {
        if hasWaypoint[i] == 0 {
          guard let next = nav.nextWaypoint(Point(Double(x[i]), Double(y[i])), goalId) else {
            // No route: jiggle. Either it is embedded in a wall's expanded hull
            // and works its way out, or the goal is genuinely unreachable.
            let escape = behaviour.escapeStep(i, radius, personalSpace)
            stepTaken = escape.length > 0
            left -= jsMax(escape.length, 1)
            continue
          }
          waypointX[i] = Float(next.point.x)
          waypointY[i] = Float(next.point.y)
          costToGoal[i] = Float(next.cost)
          waypointNode[i] = Int32(next.node)
          hasWaypoint[i] = 1
        }

        // String-pull: if the node *after* the current waypoint is already in
        // sight, aim straight at it. Without it every agent walks to the same
        // corner coordinate before turning, so crowds pile up on graph nodes.
        if waypointNode[i] >= 0 {
          let ahead = nav.successorOf(Int(waypointNode[i]), goalId)
          if let aheadPos = nav.nodePosition(ahead),
             nav.canSee(Point(Double(x[i]), Double(y[i])), aheadPos) {
            waypointX[i] = Float(aheadPos.x)
            waypointY[i] = Float(aheadPos.y)
            waypointNode[i] = Int32(ahead)
          }
        }

        let target = Point(Double(waypointX[i]), Double(waypointY[i]))
        // Substeps of up to sqrt(2): the farthest one decision ever moved
        // anybody on the lattice, kept as the decision cadence.
        let result = behaviour.stepTowards(i, target, radius, personalSpace, jsMin(SQRT2, left))
        stepTaken = result.length > 0
        left -= stepTaken ? result.length : left
        if result.replan { hasWaypoint[i] = 0 }

        if distance(Point(Double(x[i]), Double(y[i])), target) <= 1 { hasWaypoint[i] = 0 }

        if nav.hasArrived(Point(Double(x[i]), Double(y[i])), goalId, radius + 1) {
          markArrived(i)
          break
        }
      }

      // Straight-line distance rather than path length: the fundamental diagram
      // wants progress made, and a shuffle on the spot is none.
      stepDist[i] = Float(jsHypot(Double(x[i]) - here.x, Double(y[i]) - here.y))

      let gained = costBefore - Double(costToGoal[i])
      if gained > STALL_PROGRESS { stalled[i] = Float(jsMax(0, Double(stalled[i]) - 2)) }
      else { stalled[i] = Float(Double(stalled[i]) + 1) }
    }
  }

  /// The one place an agent becomes arrived, so nothing watching it is missed.
  private func markArrived(_ i: Int) {
    arrived[i] = 1
    color[i] = packRgb(BLACK)   // matches IntelligentPedestrian:113
    justArrived.append(i)
  }

  private func grow() {
    let next = capacity * 2
    func growF(_ a: inout [Float], _ fill: Float = 0) {
      a.append(contentsOf: [Float](repeating: fill, count: next - a.count))
    }
    func growI(_ a: inout [Int32], _ fill: Int32 = 0) {
      a.append(contentsOf: [Int32](repeating: fill, count: next - a.count))
    }
    func growU8(_ a: inout [UInt8]) {
      a.append(contentsOf: [UInt8](repeating: 0, count: next - a.count))
    }
    growF(&x); growF(&y); growF(&originX); growF(&originY)
    growI(&goal); growU8(&arrived)
    color.append(contentsOf: [UInt32](repeating: 0, count: next - color.count))
    growF(&waypointX); growF(&waypointY); growU8(&hasWaypoint); growI(&waypointNode, -1)
    growF(&headingX); growF(&headingY)
    growF(&waited); growF(&stalled); growF(&pressure)
    growF(&pushX); growF(&pushY); growF(&density); growF(&stepDist)
    growF(&trait); growF(&assertiveness); growI(&party)
    growF(&effectiveSpace); growF(&costToGoal, .infinity)
    growU8(&selected); growU8(&spawned)
    capacity = next
  }
}

public let BLACK: RGB = (0, 0, 0)

public func packRgb(_ c: RGB) -> UInt32 {
  UInt32(bitPattern: Int32(((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255)))
}

public func unpackRgb(_ v: UInt32) -> RGB {
  (Int((v >> 16) & 255), Int((v >> 8) & 255), Int(v & 255))
}

/// Two independent traits come from one placement, so they need one seed each --
/// otherwise how much room somebody wants and how hard they press would be the
/// same number, and the crowd would have one personality rather than two crossed.
public let SPACE_SEED = Int32(bitPattern: 0x9e3779b9)
public let NERVE_SEED = Int32(bitPattern: 0x85ebca6b)
public let PARTY_SEED = Int32(bitPattern: 0x27d4eb2f)

/// How near two pedestrians had to be painted to count as out together.
/// A constant rather than a multiple of the radius: the radius is a setting, and
/// deriving who is with whom from it would re-shuffle every party on the map the
/// moment somebody moved a slider.
private let PARTY_CELL: Double = 60
private let PARTY_SHARE: Double = 0.45

/// Which party a pedestrian belongs to, or -1 for one walking alone.
public func partyOf(_ ox: Double, _ oy: Double) -> Int {
  let cx = (ox / PARTY_CELL).rounded(.down)
  let cy = (oy / PARTY_CELL).rounded(.down)
  if traitOf(cx, cy, PARTY_SEED) >= PARTY_SHARE { return -1 }
  // `>>> 1` yields [0, 2^31), which fits Int32.
  return Int(ushr(imulD(cx, 73856093) ^ imulD(cy, 19349663), 1))
}

/// A stable number in [0,1) from a placement, well spread for nearby inputs.
///
/// The brush lays pedestrians on a regular pitch, so neighbouring origins differ
/// by a constant -- which a weaker mix would turn into a visible stripe of
/// identical temperaments across the crowd.
///
/// `jsRound`, not `.rounded()`: placements are routinely negative and the two
/// disagree on every half there.
public func traitOf(_ ox: Double, _ oy: Double, _ seed: Int32) -> Double {
  var h = seed ^ imul(toInt32(jsRound(ox)), 73856093) ^ imul(toInt32(jsRound(oy)), 19349663)
  h = imul(h ^ ushr(h, 15), Int32(bitPattern: 2246822519))
  h = imul(h ^ ushr(h, 13), Int32(bitPattern: 3266489917))
  h ^= ushr(h, 16)
  return Double(toUint32(h)) / 4294967296
}
