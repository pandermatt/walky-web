import Foundation

/// The accumulator that owes the simulation its sixty steps a second.
/// Ports `src/sim/clock.ts`.
///
/// The debt is capped: past `maxSubsteps` per frame the remainder is forgiven
/// and simulated time runs slower than the wall clock, which is the stance the
/// model always took on slow machines -- the crowd and the doors slow down
/// together, rather than the spiral of death.
public let MAX_SUBSTEPS = 3

public final class Clock {
  private var acc: Double = 0
  private var last: Double?
  private let stepMs: Double
  private let maxSubsteps: Int

  public init(stepMs: Double = STEP_MS, maxSubsteps: Int = MAX_SUBSTEPS) {
    self.stepMs = stepMs
    self.maxSubsteps = maxSubsteps
  }

  /// Forgets where the clock was. Time spent paused is not owed, and resuming
  /// must not open on a burst of catch-up steps.
  public func reset() {
    acc = 0
    last = nil
  }

  /// Banks the time since the previous call and returns how many whole steps it
  /// buys. The first call after a reset buys exactly one, so pressing play moves
  /// the crowd on the very frame it was pressed.
  public func advance(_ nowMs: Double) -> Int {
    guard let previous = last else {
      last = nowMs
      return 1
    }
    acc += jsMax(0, nowMs - previous)
    last = nowMs
    var steps = Int((acc / stepMs).rounded(.down))
    if steps > maxSubsteps {
      steps = maxSubsteps
      acc = 0
    } else {
      acc -= Double(steps) * stepMs
    }
    return steps
  }
}
