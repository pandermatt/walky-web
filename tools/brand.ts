/**
 * The colours the project uses to present itself: the share card and the app
 * icons, both of which have to pick specific colours where the app picks random
 * ones.
 *
 * Every value is legal under randomBrightColor's rule -- at least one channel in
 * 150-255, the other two free -- so a wall could genuinely come out this colour.
 * The magenta is the #C419C0 the README names as the shade that sticks in memory.
 *
 * They live here rather than in src/palette.ts because that file documents the
 * two colour *rules* ported from the 2016 original, and a brand palette is not
 * one of them.
 */
import type { RGB } from '../src/palette.ts';

export const MAGENTA: RGB = [196, 25, 192];
export const TEAL: RGB = [41, 214, 168];
export const LIME: RGB = [168, 214, 66];
export const RUST: RGB = [214, 66, 39];
export const SKY: RGB = [66, 158, 214];
