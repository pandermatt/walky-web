/**
 * The iOS 26 app icon, as an Icon Composer document.
 *
 * Run with:  npx vite-node tools/iosIcon.ts
 *
 * Same mark as `appIcons.ts` -- three pedestrians packed into a triangle, each
 * a filled dot in a goal colour with a white ring -- but authored as layers in
 * a `.icon` bundle rather than flattened to a PNG. That is what buys Liquid
 * Glass: the system composites the layers itself, giving them specular
 * highlights, parallax, and the dark and tinted variants, none of which a flat
 * image can have.
 *
 * The dots are translucent so the glass reads as glass. A solid fill under a
 * glass treatment looks like a sticker on a window; letting the ground show
 * through is what makes the three of them look like objects *in* the material.
 * The white rings stay opaque -- they are the pedestrian's outline, the one
 * part of the mark that has to hold its shape at 40px.
 *
 * Geometry is lifted from `crowd()` in appIcons.ts and doubled, since Icon
 * Composer works on a 1024 canvas where that one works on 512.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKGROUND, WHITE, toCss, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, TEAL } from './brand.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'ios/App/Walky.icon');

/** Icon Composer's canvas. */
const BOX = 1024;
const CENTRE = BOX / 2;
/** `REACH` from appIcons.ts, doubled for this canvas. */
const REACH = 352;

/** How much of the ground shows through a dot. */
const DOT_ALPHA = 0.78;

// The same solve as appIcons.ts `crowd()`.
const ring = REACH * 0.075;
const r = (REACH - ring / 2) / 1.98;
const R = r * 0.98;
const dx = R * Math.cos(Math.PI / 6);
const dy = R * Math.sin(Math.PI / 6);

interface Dot { name: string; cx: number; cy: number; fill: RGB; }

/**
 * The two behind first, the leader over them -- the same order the crowd would
 * land in if it were walking up the page, and the order the layers stack in.
 */
const DOTS: Dot[] = [
  { name: 'walker-left', cx: CENTRE - dx, cy: CENTRE + dy, fill: TEAL },
  { name: 'walker-right', cx: CENTRE + dx, cy: CENTRE + dy, fill: LIME },
  { name: 'walker-lead', cx: CENTRE, cy: CENTRE - R, fill: MAGENTA },
];

/** One pedestrian on a transparent ground: translucent body, opaque ring. */
function layerSvg(d: Dot): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">
  <circle cx="${d.cx.toFixed(2)}" cy="${d.cy.toFixed(2)}" r="${r.toFixed(2)}"
          fill="${toCss(d.fill)}" fill-opacity="${DOT_ALPHA}"
          stroke="${toCss(WHITE)}" stroke-width="${ring.toFixed(2)}"/>
</svg>
`;
}

const [bg0, bg1, bg2] = BACKGROUND;
const ground = `extended-srgb:${(bg0 / 255).toFixed(5)},${(bg1 / 255).toFixed(5)},`
  + `${(bg2 / 255).toFixed(5)},1.00000`;

/**
 * `is-glass` is the flag that asks the system for the Liquid Glass treatment
 * per layer. The ground stays the app's own `#1E1E1E` -- derived in
 * palette.ts from `Color.DARK_GRAY.darker().darker()`, so even the icon's
 * background is the 2016 original's arithmetic rather than a number typed in.
 */
const doc = {
  fill: { 'automatic-gradient': ground },
  groups: [
    {
      layers: DOTS.map((d) => ({
        'image-name': `${d.name}.svg`,
        name: d.name,
        'is-glass': true,
      })),
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: true, value: 0.5 },
    },
  ],
  'supported-platforms': {
    circles: ['watchOS'],
    squares: ['iOS'],
  },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'Assets'), { recursive: true });
for (const d of DOTS) {
  writeFileSync(join(OUT, 'Assets', `${d.name}.svg`), layerSvg(d));
}
writeFileSync(join(OUT, 'icon.json'), JSON.stringify(doc, null, 2) + '\n');

console.log(`${OUT}`);
console.log(`  icon.json + ${DOTS.length} layers, ground ${toCss(BACKGROUND)}, dots at ${DOT_ALPHA} alpha`);
