import Foundation

/// The bridge between the map's pixels and the world's metres and seconds.
///
/// Ports `src/sim/units.ts`. The model runs, and always ran, in pixels per
/// tick -- every constant in Behaviour is tuned in that currency. The anchor is
/// the body: the default pedestrian radius of 13px stands for Weidmann's 0.232m
/// shoulder radius, which fixes the scale at 56 px to the metre.
public let PX_PER_METRE: Double = 56

/// A tick is a sixtieth of a second of simulated time by definition, not by hope.
public let TICKS_PER_SECOND: Double = 60

/// How long one tick lasts on the wall clock.
public let STEP_MS: Double = 1000 / TICKS_PER_SECOND

/// A walking speed in metres per second, as the px-per-tick the model spends.
public func pxPerTickFromMps(_ mps: Double) -> Double {
  (mps * PX_PER_METRE) / TICKS_PER_SECOND
}

/// A px-per-tick pace, as the metres per second it stands for.
public func mpsFromPxPerTick(_ pxPerTick: Double) -> Double {
  (pxPerTick * TICKS_PER_SECOND) / PX_PER_METRE
}

/// A headcount inside a circular window, as persons per square metre.
public func personsPerM2(_ count: Double, _ windowRadiusPx: Double) -> Double {
  let rMetres = windowRadiusPx / PX_PER_METRE
  return count / (Double.pi * rMetres * rMetres)
}
