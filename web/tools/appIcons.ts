/**
 * Renders the favicon and the installed-app icons.
 *
 * Run with:  npx vite-node tools/appIcons.ts
 *
 * Like the share card, the PNGs are committed and this is not part of
 * `npm run build` -- regenerating them is a decision.
 *
 * The mark is the app's own pedestrian: a filled dot in its goal's colour with a
 * white ring, which is what PedestrianPanel.drawPedestrian has always drawn. It
 * is built from primitives rather than from a pictogram, so there is no artwork
 * here whose provenance anyone has to take on trust.
 *
 * Two sizes of the same idea. A crowd of three reads as "many pedestrians, going
 * somewhere" and carries the home screen, where there is room for it; at 16px a
 * cluster silts up into one blob, so the browser tab gets a single pedestrian
 * instead. Same language, each used where it survives.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKGROUND, WHITE, toCss, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, TEAL } from './brand.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/images');

/** Everything is drawn in this square and scaled on the way out. */
const BOX = 512;
const CENTRE = BOX / 2;

/** iOS's own rounding is close to this, and Android rounds "any" icons itself. */
const CORNER = 112;

/**
 * How far from the centre the artwork is allowed to reach.
 *
 * A maskable icon may be cropped to the inner 80% -- a circle of radius 204.8
 * here -- so anything outside that can be taken off by a launcher. The margin
 * below the limit is what stops a circular crop shaving the outer rings.
 */
const REACH = 176;

/** One pedestrian, exactly as the app draws it: goal-coloured dot, white ring. */
function pedestrian(cx: number, cy: number, r: number, fill: RGB, ring: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${toCss(fill)}"`
    + ` stroke="${toCss(WHITE)}" stroke-width="${ring}"/>`;
}

/**
 * Three pedestrians packed into a triangle, close enough that their rings cross.
 *
 * The overlap is the point: pedestrians in the app crowd until they touch, and
 * three tangent circles read as a diagram rather than as a crowd. Geometry is
 * derived from `reach` so the whole cluster scales as one.
 */
function crowd(reach: number): string {
  // Solving reach = R + r + ring/2 with the spacing that gives a snug cluster
  // (centres about 1.7 radii apart, so R sqrt(3) = 1.7 r).
  const ring = reach * 0.075;
  const r = (reach - ring / 2) / 1.98;
  const R = r * 0.98;
  const dx = R * Math.cos(Math.PI / 6);
  const dy = R * Math.sin(Math.PI / 6);
  const at = (x: number, y: number, c: RGB) => pedestrian(x, y, r, c, ring);
  // The two behind first, the leader over them -- the same order the crowd
  // would land in if it were walking up the page.
  return [
    at(CENTRE - dx, CENTRE + dy, TEAL),
    at(CENTRE + dx, CENTRE + dy, LIME),
    at(CENTRE, CENTRE - R, MAGENTA),
  ].join('\n  ');
}

/** One pedestrian, filling the tile: what is left when there is no room for three. */
function solo(reach: number): string {
  const ring = reach * 0.15;
  return pedestrian(CENTRE, CENTRE, reach - ring / 2, MAGENTA, ring);
}

function svg(art: string, rounded: boolean): string {
  const ground = rounded
    ? `<rect width="${BOX}" height="${BOX}" rx="${CORNER}" fill="${toCss(BACKGROUND)}"/>`
    : `<rect width="${BOX}" height="${BOX}" fill="${toCss(BACKGROUND)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">
  ${ground}
  ${art}
</svg>
`;
}

interface IconSpec {
  file: string;
  size: number;
  art: string;
  /**
   * Rounded here, or left square for the platform to mask. iOS applies its own
   * squircle to the touch icon and a launcher applies its own shape to a maskable
   * one, so rounding those ourselves would round an already-rounded corner and
   * leave the ground showing through outside it.
   */
  rounded: boolean;
}

const icons: IconSpec[] = [
  // The browser tab, where the mark is 16-32px and a cluster would silt up.
  { file: 'icon.png', size: 128, art: solo(REACH), rounded: true },
  // Home screens and launchers, where there is room for the crowd.
  { file: 'apple-touch-icon.png', size: 180, art: crowd(REACH), rounded: false },
  { file: 'icon-192.png', size: 192, art: crowd(REACH), rounded: true },
  { file: 'icon-512.png', size: 512, art: crowd(REACH), rounded: true },
  { file: 'icon-maskable-512.png', size: 512, art: crowd(REACH), rounded: false },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const icon of icons) {
  const src = join(tmpdir(), `walky-${icon.file}.svg`);
  writeFileSync(src, svg(icon.art, icon.rounded));
  const out = join(OUT_DIR, icon.file);
  execFileSync('rsvg-convert', ['-w', String(icon.size), '-h', String(icon.size), '-o', out, src]);
  console.log(`${icon.file.padEnd(24)} ${icon.size}x${icon.size}`);
}
