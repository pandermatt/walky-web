import Foundation

/// When a generator lets people out, and how many at a time.
/// Ports `src/sim/arrivals.ts`.
///
/// A door paying out one sixtieth of its rate a tick is a metronome, and nobody
/// arrives at a door like that. This is batch arrivals -- compound Poisson --
/// with the burst size and interval chosen so the people per second averages out
/// at exactly what the slider says.
///
/// Everything is a hash rather than `Math.random`, so Reset replays the same
/// demand through the same door and a map that arrives down a link behaves the
/// way it behaved for whoever sent it.

private let MEAN_BURST: Double = 4
private let MIN_MEAN_BURST: Double = 1.5

/// The mean clump for a door running at `rate`: a second's worth, up to four.
private func meanBurstFor(_ rate: Double) -> Double {
  jsMin(MEAN_BURST, jsMax(MIN_MEAN_BURST, rate))
}

/// The largest clump one draw may ask for. The point is not the arithmetic but
/// that a door is a door: sixteen is already twice what its mouth can hold.
private let MAX_BURST: Double = 16

/// The most people that may be waiting behind a door. Without a ceiling the
/// queue behind a blocked door grows for as long as the jam lasts and then
/// empties into the first gap that appears.
public let QUEUE_MAX: Double = 3 * MEAN_BURST

private let GAP_CUTOFF: Double = 2
/// `1 - Math.exp(-GAP_CUTOFF)`, computed through the same fdlibm the model uses
/// rather than written down, since it is a module-init value in the original.
private let GAP_KEPT: Double = 1 - jsExp(-GAP_CUTOFF)

/// Three independent streams from the one hash: which door, how many, how long
/// until the next. Different seeds, or a door's size and its silence would be
/// the same number wearing two hats.
private let DOOR_SEED = Int32(bitPattern: 0x1b873593)
private let SIZE_SEED = Int32(bitPattern: 0xcc9e2d51)
private let GAP_SEED = Int32(bitPattern: 0x6c078965)

public struct Burst {
  /// How many arrive together. At least one.
  public var size: Double
  /// Ticks until the next burst. At least one, so a door cannot fire twice a tick.
  public var gap: Double
}

/// A door's own number, so that no two share a schedule.
///
/// Taken from where it stands rather than from its id: an id is minted fresh
/// every time a map is opened, so a shared map would arrive with a different
/// flow through the same door.
private func doorOf(_ at: Point) -> Double {
  jsRound(traitOf(at.x, at.y, DOOR_SEED) * 0x7fffffff)
}

/// The `beat`th clump out of the door at `at`, for a door running at `rate`
/// people a second.
public func burstAt(_ at: Point, _ beat: Double, _ rate: Double) -> Burst {
  let door = doorOf(at)
  let size = sizeOf(traitOf(beat, door, SIZE_SEED), rate)
  return Burst(size: size, gap: gapOf(traitOf(beat, door, GAP_SEED), size, rate))
}

/// A geometric draw with the mean this door's rate calls for, from a uniform in [0,1).
private func sizeOf(_ u: Double, _ rate: Double) -> Double {
  let p = 1 / meanBurstFor(rate)
  let k = 1 + (jsLog(1 - u) / jsLog(1 - p)).rounded(.down)
  return jsMin(MAX_BURST, k)
}

/// An exponential draw about the time `size` people are worth, in whole ticks.
private func gapOf(_ v: Double, _ size: Double, _ rate: Double) -> Double {
  let seconds = size / jsMax(1, rate)
  let spread = jsMin(-jsLog(1 - v), GAP_CUTOFF) / GAP_KEPT
  return jsMax(1, jsRound(seconds * spread * TICKS_PER_SECOND))
}
