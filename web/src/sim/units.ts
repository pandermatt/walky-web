/**
 * The bridge between the map's pixels and the world's metres and seconds.
 *
 * The model itself runs, and always ran, in pixels per tick -- every constant in
 * behaviour.ts is tuned in that currency and every test asserts in it. What was
 * missing was the exchange rate, without which "is 4 px/tick a stroll or a
 * sprint?" had no answer and none of the published pedestrian numbers -- the
 * 1.34 m/s free walking speed, densities in persons per square metre, the
 * fundamental diagram -- could be compared against anything the crowd does.
 *
 * The anchor is the body, the one pixel quantity that is unarguably a physical
 * thing: the default pedestrian radius of 13px stands for Weidmann's 0.23m
 * shoulder radius, which fixes the scale at 56 px to the metre (13 / 0.232). At
 * that scale the corridor in the tests is about 7m wide, a personal space of
 * 40px is a 0.7m bubble, and Weidmann's 1.34 m/s free speed comes out at 1.25
 * px/tick -- which says the long-standing default speed of 4 was a 4.3 m/s jog,
 * a debt settled where the speed setting is defined.
 */
export const PX_PER_METRE = 56;

/**
 * The simulation's own clock, decoupled from the display's.
 *
 * A tick is a sixtieth of a second of simulated time by definition, not by hope:
 * the loop in app.ts owes this many steps per wall-clock second whatever the
 * monitor refreshes at, where it used to run one step per frame and therefore
 * twice as fast on a 120Hz display.
 */
export const TICKS_PER_SECOND = 60;

/** How long one tick lasts on the wall clock. */
export const STEP_MS = 1000 / TICKS_PER_SECOND;

/** A walking speed in metres per second, as the px-per-tick the model spends. */
export function pxPerTickFromMps(mps: number): number {
  return (mps * PX_PER_METRE) / TICKS_PER_SECOND;
}

/** A px-per-tick pace, as the metres per second it stands for. */
export function mpsFromPxPerTick(pxPerTick: number): number {
  return (pxPerTick * TICKS_PER_SECOND) / PX_PER_METRE;
}

/**
 * A headcount inside a circular window, as the persons per square metre it
 * amounts to. The window is the one the model already measures -- the density
 * field counts neighbours within a radius -- so the same number feeds the
 * pace curve and the readout.
 */
export function personsPerM2(count: number, windowRadiusPx: number): number {
  const rMetres = windowRadiusPx / PX_PER_METRE;
  return count / (Math.PI * rMetres * rMetres);
}
