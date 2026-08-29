/**
 * The two colour rules that define Walky's look, ported from the 2016 original.
 *
 * Sources:
 *   math/RandomGenerator.java:41   randomBrightColor()
 *   java.awt.Color.darker()        the shadow
 *   gui/PedestrianPanel.java:258   the background
 */

export type RGB = readonly [number, number, number];

/** Java's `Color.darker()`: multiply each channel by 0.7 and truncate toward zero. */
export function javaDarker(c: RGB): RGB {
  return [
    Math.max(0, Math.trunc(c[0] * 0.7)),
    Math.max(0, Math.trunc(c[1] * 0.7)),
    Math.max(0, Math.trunc(c[2] * 0.7)),
  ];
}

/** The wall shadow colour: `darker()` applied twice. */
export function shadowOf(c: RGB): RGB {
  return javaDarker(javaDarker(c));
}

/** `ThreadLocalRandom.nextInt(from, to + 1)` — inclusive at both ends. */
function randomNumber(from: number, to: number): number {
  return from + Math.floor(Math.random() * (to - from + 1));
}

/**
 * A colour that is never dark: one channel picked at random is forced to 150-255,
 * the other two range freely over 0-255.
 *
 * The original's javadoc claims "at least 1 RGB-Value is > 150" but the code says
 * randomNumber(150, 255), so 150 itself is reachable. Kept as the code has it.
 */
export function randomBrightColor(): RGB {
  const bright = randomNumber(1, 3);
  return [
    bright === 1 ? randomNumber(150, 255) : randomNumber(0, 255),
    bright === 2 ? randomNumber(150, 255) : randomNumber(0, 255),
    bright === 3 ? randomNumber(150, 255) : randomNumber(0, 255),
  ];
}

/** `Color.DARK_GRAY.darker().darker()` = (64,64,64) -> (44,44,44) -> (30,30,30). */
export const BACKGROUND: RGB = shadowOf([64, 64, 64]);

/** Fixed palette entries the original used by name. */
export const WHITE: RGB = [255, 255, 255];
export const BLUE: RGB = [0, 0, 255];
export const YELLOW: RGB = [255, 255, 0];
export const ORANGE: RGB = [255, 200, 0];
export const RED: RGB = [255, 0, 0];
export const BLACK: RGB = [0, 0, 0];

export function toCss(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function toHex(c: RGB): string {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}
