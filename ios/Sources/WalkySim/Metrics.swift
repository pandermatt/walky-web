import Foundation

/// What the crowd measures about itself. Ports `src/sim/metrics.ts`.
///
/// The three numbers the pedestrian literature reports -- speed in metres per
/// second, density in persons per square metre, flow in persons per second --
/// read off state the model already keeps, so a run can be compared against
/// published data while it walks.
///
/// Nothing here feeds back into behaviour. The crowd cannot see its own
/// readout, so switching the metrics on or off changes no run by a single
/// pixel -- and the conformance traces would catch it if it did.

/// Flow is judged over the last five seconds, long enough to smooth a burst.
public let THROUGHPUT_WINDOW_TICKS = Int(5 * TICKS_PER_SECOND)

/// Fundamental-diagram bins, in persons per square metre.
public let FD_BIN_WIDTH: Double = 0.25
private let FD_BINS = 32

/// How often the diagram takes a sample; every tick would be 60 copies of one fact.
public let FD_EVERY = 10

public struct FdBin {
  /// Centre of the density bin, persons/m².
  public var density: Double
  /// Mean walking speed observed at that density, m/s.
  public var speed: Double
  /// How many pedestrian-ticks the mean is over.
  public var samples: Double
}

public struct Readout {
  /// Mean walking speed of everybody still going, m/s, over the flow window.
  public var meanSpeedMps: Double
  /// Mean and worst crowding around a walker, persons/m².
  public var meanDensity: Double
  public var maxDensity: Double
  /// Arrivals per second over the last five seconds.
  public var throughputPerSecond: Double
}

public final class Metrics {
  private var arrivalsRing = [Double](repeating: 0, count: THROUGHPUT_WINDOW_TICKS)
  private var movedRing = [Double](repeating: 0, count: THROUGHPUT_WINDOW_TICKS)
  private var walkersRing = [Double](repeating: 0, count: THROUGHPUT_WINDOW_TICKS)
  private var at = 0
  private var seen = 0

  private var fdSpeedSum = [Double](repeating: 0, count: FD_BINS)
  private var fdSamples = [Double](repeating: 0, count: FD_BINS)
  private var lastMeanDensity: Double = 0
  private var lastMaxDensity: Double = 0
  private var ticks = 0

  public init() {}

  /// Forgets the run, for a Reset or a cleared map.
  public func reset() {
    for i in 0..<arrivalsRing.count { arrivalsRing[i] = 0; movedRing[i] = 0; walkersRing[i] = 0 }
    at = 0
    seen = 0
    for i in 0..<FD_BINS { fdSpeedSum[i] = 0; fdSamples[i] = 0 }
    lastMeanDensity = 0
    lastMaxDensity = 0
    ticks = 0
  }

  /// Reads one tick off the crowd. Call straight after `Agents.step`, while
  /// `justArrived` still holds the tick's arrivals and before any removal
  /// shuffles the slots.
  public func sample(_ agents: Agents, _ radiusPx: Double) {
    let windowPx = PACE_WINDOW * radiusPx
    var moved: Double = 0
    var walkers: Double = 0
    var densitySum: Double = 0
    var densityMax: Double = 0
    let takeFd = ticks % FD_EVERY == 0

    for i in 0..<agents.count {
      if agents.arrived[i] != 0 || agents.goal[i] < 0 { continue }
      walkers += 1
      moved += Double(agents.stepDist[i])
      let d = personsPerM2(Double(agents.density[i]), windowPx)
      densitySum += d
      if d > densityMax { densityMax = d }
      if takeFd {
        // `Math.floor` on a density JS would happily let be NaN. Clamped rather
        // than converted blind: `Int(Double)` traps on NaN or out of range,
        // where JS coerces.
        let raw = (d / FD_BIN_WIDTH).rounded(.down)
        let bin = raw.isFinite ? Int(jsMin(Double(FD_BINS - 1), jsMax(0, raw))) : 0
        fdSpeedSum[bin] += mpsFromPxPerTick(Double(agents.stepDist[i]))
        fdSamples[bin] += 1
      }
    }

    arrivalsRing[at] = Double(agents.justArrived.count)
    movedRing[at] = moved
    walkersRing[at] = walkers
    at = (at + 1) % THROUGHPUT_WINDOW_TICKS
    if seen < THROUGHPUT_WINDOW_TICKS { seen += 1 }

    lastMeanDensity = walkers > 0 ? densitySum / walkers : 0
    lastMaxDensity = densityMax
    ticks += 1
  }

  public func readout() -> Readout {
    var arrivals: Double = 0
    var moved: Double = 0
    var walkerTicks: Double = 0
    for t in 0..<seen {
      arrivals += arrivalsRing[t]
      moved += movedRing[t]
      walkerTicks += walkersRing[t]
    }
    let seconds = Double(seen) / TICKS_PER_SECOND
    return Readout(
      meanSpeedMps: walkerTicks > 0 ? mpsFromPxPerTick(moved / walkerTicks) : 0,
      meanDensity: lastMeanDensity,
      maxDensity: lastMaxDensity,
      throughputPerSecond: seconds > 0 ? arrivals / seconds : 0)
  }

  /// The speed-against-density curve the run has traced so far.
  public func fundamentalDiagram() -> [FdBin] {
    var out: [FdBin] = []
    for b in 0..<FD_BINS {
      if fdSamples[b] == 0 { continue }
      out.append(FdBin(density: (Double(b) + 0.5) * FD_BIN_WIDTH,
                       speed: fdSpeedSum[b] / fdSamples[b],
                       samples: fdSamples[b]))
    }
    return out
  }
}
