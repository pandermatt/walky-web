/**
 * The iMessage sticker pack: ../ios/Stickers/Stickers.xcstickers.
 *
 * Run with:  npx vite-node tools/stickers.ts
 *
 * Eighteen characters, cut out of the three contact sheets in `sheets/` by
 * `sheetSlice.ts` -- which is where the interesting half of this lives: how a
 * sheet becomes nine drawings, and why the frame around each one is measured off
 * the art instead of off a grid.
 *
 * WHERE THE ART COMES FROM, AND WHAT THAT COSTS. The sheets were drawn by
 * ChatGPT and are committed exactly as they arrived. That is a real break with
 * the rest of the brand: `appIcons.ts` and `iosIcon.ts` build every mark out of
 * the app's own primitives -- a pedestrian is a circle in a goal colour with a
 * white ring, which is what `PedestrianPanel.drawPedestrian` has drawn since
 * 2016 -- specifically so that nothing in them has a provenance anybody has to
 * take on trust. These do. Nobody can point at a rule in `palette.ts` and derive
 * the green of the character on the first sticker.
 *
 * So the honest description of this file is narrower than it used to be: what is
 * generated here is the cut, the frame, the order and the catalogue. The
 * drawings are input. Keeping the sheets in the repository next to the tool is
 * what keeps that reproducible rather than merely asserted -- run this and you
 * get the committed PNGs back, byte for byte.
 *
 * THE SHEETS HELD TWENTY-SEVEN. Nine of them said a line another sheet had
 * already said -- three "AH SO CROWDED HERE!", three "ON MY WAY!", three "WHERE
 * ARE WE GOING?" -- in a different drawing each time. A drawer where three
 * stickers carry identical words is a drawer you have to read to use, so one
 * drawing of each line is in `CHARACTERS` below and the others are left on the
 * sheet. They are still in `sheets/`: bringing one back is an edit to a list,
 * not a hunt.
 *
 * THE GROUND IS TRANSPARENT. A sticker lands on somebody's bubble or somebody's
 * photo, so it cannot take the way out the favicon and the home-screen icon take
 * and sit on an opaque #1E1E1E tile -- a tile there reads as a screenshot of the
 * app rather than as a sticker of it. These drawings arrive with a white keyline
 * already around them, which is the job `KEY` does for the drawer icon below,
 * arrived at from the other side.
 *
 * Like the icons and the share card, the output is committed and this is not
 * part of `npm run build`. Regenerating is a decision.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKGROUND, WHITE, toCss, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, TEAL } from './brand.ts';
import { sliceSheet } from './sheetSlice.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '../ios/Stickers/Stickers.xcstickers');
const PACK = join(OUT, 'Sticker Pack.stickerpack');
const ICONSET = join(OUT, 'iMessage App Icon.stickersiconset');
const SHEETS = join(ROOT, 'tools/sheets');

/**
 * The image size a `regular` grid wants: three stickers to a row.
 *
 * `small` (300) loses the crowd's three rings to each other on the drawer icon
 * and `large` (618) gives two-to-a-row billing to drawings that are, at bottom,
 * a face on a circle. Three across is the width these were drawn at.
 */
const BOX = 408;
const CENTRE = BOX / 2;

/** How far from the centre a mark may reach. */
const REACH = BOX * 0.43;

/** The keyline: the map's ground, carried out to the edge of every mark. */
const KEY = BOX * 0.02;

const f = (n: number) => n.toFixed(2);

/**
 * One pedestrian, as the app draws it, over a silhouette of itself.
 *
 * Drawn as a pair rather than as a third stroke so that a crowd separates
 * correctly: each dot lays its own ground down before it paints, so the one in
 * front cuts a dark edge into the ring of the one behind -- which is what they
 * look like on the map, where the ground is genuinely between them.
 */
function pedestrian(cx: number, cy: number, r: number, fill: RGB, ring: number): string {
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + ring / 2 + KEY)}" fill="${toCss(BACKGROUND)}"/>
  <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${toCss(fill)}"`
    + ` stroke="${toCss(WHITE)}" stroke-width="${f(ring)}"/>`;
}

/**
 * The app's own mark: three pedestrians packed into a triangle.
 *
 * The solve is `crowd()` from appIcons.ts, which is where the mark was settled;
 * repeated here rather than imported because that module is a script that writes
 * PNGs on import, and lifting six lines of arithmetic is cheaper than making it
 * importable. If it moves, it moves in both.
 *
 * The characters in the drawer are not built from this. The drawer *icon* still
 * is, which is the point: the thing Messages shows in its app strip is the app's
 * mark, in the app's colours, on the app's ground.
 */
function crowd(reach: number): string {
  const ring = reach * 0.075;
  const r = (reach - ring / 2) / 1.98;
  const R = r * 0.98;
  const dx = R * Math.cos(Math.PI / 6);
  const dy = R * Math.sin(Math.PI / 6);
  // The two behind first, the leader over them -- the order the crowd would land
  // in if it were walking up the page.
  return [
    pedestrian(CENTRE - dx, CENTRE + dy, r, TEAL, ring),
    pedestrian(CENTRE + dx, CENTRE + dy, r, LIME, ring),
    pedestrian(CENTRE, CENTRE - R, r, MAGENTA, ring),
  ].join('\n  ');
}

// -------------------------------------------------------------- the catalogue

interface Character {
  /** Which sheet in `sheets/`, and which of its nine cells, reading across. */
  sheet: 1 | 2 | 3;
  cell: number;
  /** The folder, and the PNG inside it. */
  name: string;
  /**
   * What VoiceOver reads in the sticker browser.
   *
   * The words on the sticker lead, because the words *are* the sticker -- a
   * label that opened with the drawing would make somebody listen through
   * "a pedestrian wincing" to find out which of the tired ones this is.
   */
  label: string;
}

/**
 * The order is a walk, not the order the sheets came in: set out, get lost,
 * push, tire, recover, resolve, arrive. Six rows of three, and each row holds
 * together on its own, because the drawer is browsed a row at a time.
 */
const CHARACTERS: Character[] = [
  { sheet: 1, cell: 1, name: 'walky-time', label: 'Walky time! A pedestrian bouncing on the spot, delighted' },
  { sheet: 1, cell: 9, name: 'on-my-way', label: 'On my way! A pedestrian striding off in sunglasses, a bag over one arm' },
  { sheet: 1, cell: 2, name: 'where-are-we-going', label: 'Where are we going? A pedestrian frowning at a folded map' },

  { sheet: 2, cell: 5, name: 'exploring-new-routes', label: 'Exploring new routes! A pedestrian grinning over an open map, a pack on its back' },
  { sheet: 3, cell: 5, name: 'pathfinding-intensifies', label: 'Pathfinding intensifies! A pedestrian charging forward, scowling, trailing speed lines' },
  { sheet: 1, cell: 6, name: 'nope-wall', label: 'Nope, wall. A pedestrian walking face first into a wall' },

  { sheet: 3, cell: 6, name: 'lost-in-the-maze', label: 'Lost... A pedestrian stranded in a maze, a dropped pin just out of reach' },
  { sheet: 2, cell: 1, name: 'so-crowded', label: 'Ah so crowded here! A pedestrian wedged into a crowd, wincing' },
  { sheet: 2, cell: 8, name: 'excuse-me', label: 'Excuse me! A pedestrian shouldering cheerfully through a grey crowd' },

  { sheet: 2, cell: 4, name: 'one-more-stop', label: 'Just one more stop... A pedestrian hanging off a transit strap, eyes half shut' },
  { sheet: 2, cell: 7, name: 'no-energy-left', label: 'No energy left... A pedestrian face down and flat, its battery empty' },
  { sheet: 1, cell: 8, name: 'one-more-simulation', label: 'Just one more simulation... A pedestrian collapsed beside a drained battery' },

  { sheet: 1, cell: 7, name: 'coffee-first', label: 'Coffee first. A pedestrian walking off with a takeaway cup, content' },
  { sheet: 2, cell: 2, name: 'better-at-home', label: 'Better at home than in the crowd. A pedestrian on a sofa with a mug, a cat asleep beside it' },
  { sheet: 3, cell: 8, name: 'same-place-different-day', label: 'Same place, same people, different day. A pedestrian at peace in the middle of a grey crowd' },

  { sheet: 3, cell: 2, name: 'follow-my-path', label: 'Lost in life but know to follow my path. A pedestrian hiking a trail past a signpost' },
  { sheet: 3, cell: 7, name: 'progress-not-perfection', label: 'Progress not perfection. A pedestrian hauling itself up a rock face' },
  { sheet: 2, cell: 9, name: 'goal-reached', label: 'Goal reached! A pedestrian cheering on a target, a flag planted beside it' },
];

/**
 * The Messages drawer icon, which may not be transparent -- so it is the crowd
 * on the app's own #1E1E1E, exactly as the home screen has it, and the keyline
 * every mark wears disappears into the ground it was borrowed from.
 *
 * The idiom/size/scale triples are Xcode's, copied from the Sticker Pack
 * Extension template rather than reconstructed: actool rejects the set if one is
 * missing, and it does not say which.
 */
interface IconSize {
  file: string;
  w: number;
  h: number;
  entry: Record<string, string>;
}

function icon(idiom: string, size: string, scale: number, platform?: string): IconSize {
  const [sw, sh] = size.split('x').map(Number);
  // idiom + size + scale is unique across the set, so it is the whole filename.
  const file = `icon-${idiom}-${size}@${scale}x.png`;
  return {
    file,
    w: sw * scale,
    h: sh * scale,
    entry: { idiom, size, scale: `${scale}x`, ...(platform ? { platform } : {}), filename: file },
  };
}

const ICON_SIZES: IconSize[] = [
  icon('iphone', '29x29', 2),
  icon('iphone', '29x29', 3),
  icon('iphone', '60x45', 2),
  icon('iphone', '60x45', 3),
  icon('ipad', '29x29', 2),
  icon('ipad', '67x50', 2),
  icon('ipad', '74x55', 2),
  icon('universal', '27x20', 2, 'ios'),
  icon('universal', '27x20', 3, 'ios'),
  icon('universal', '32x24', 2, 'ios'),
  icon('universal', '32x24', 3, 'ios'),
  icon('ios-marketing', '1024x768', 1, 'ios'),
];

/** The crowd centred on the ground, letterboxed out to a drawer icon's shape. */
function iconSvg(w: number, h: number): string {
  const s = Math.min(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${toCss(BACKGROUND)}"/>
  <g transform="translate(${f((w - s) / 2)} ${f((h - s) / 2)}) scale(${f(s / BOX)})">
  ${crowd(REACH)}
  </g>
</svg>
`;
}

const INFO = { version: 1, author: 'xcode' };
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

function render(name: string, source: string, w: number, h: number, out: string): void {
  const src = join(tmpdir(), `walky-sticker-${name}.svg`);
  writeFileSync(src, source);
  execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', out, src]);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(PACK, { recursive: true });
mkdirSync(ICONSET, { recursive: true });

writeFileSync(join(OUT, 'Contents.json'), json({ info: INFO }));

// Cut once per sheet, not once per sticker: slicing reads a 1254-square PNG and
// labels every opaque pixel in it, and two thirds of the catalogue would pay for
// that twice over otherwise.
const cuts = new Map<number, Buffer[]>();
const cutOf = ({ sheet, cell }: Character): Buffer => {
  const nine = cuts.get(sheet)
    ?? sliceSheet(join(SHEETS, `characters-${sheet}.png`), BOX);
  cuts.set(sheet, nine);
  return nine[cell - 1];
};

for (const c of CHARACTERS) {
  const dir = join(PACK, `${c.name}.sticker`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${c.name}.png`), cutOf(c));
  writeFileSync(join(dir, 'Contents.json'), json({
    info: INFO,
    properties: { filename: `${c.name}.png`, 'accessibility-label': c.label },
  }));
}

// `stickers` is what fixes the order in the drawer; without it the pack is
// whatever order the catalogue happens to enumerate its folders in.
writeFileSync(join(PACK, 'Contents.json'), json({
  info: INFO,
  properties: { 'grid-size': 'regular' },
  stickers: CHARACTERS.map((c) => ({ filename: `${c.name}.sticker` })),
}));

for (const i of ICON_SIZES) {
  render(i.file, iconSvg(i.w, i.h), i.w, i.h, join(ICONSET, i.file));
}
writeFileSync(join(ICONSET, 'Contents.json'), json({
  images: ICON_SIZES.map((i) => i.entry),
  info: INFO,
}));

console.log(`${OUT}`);
console.log(`  ${CHARACTERS.length} stickers at ${BOX}x${BOX}, regular grid`);
console.log(`  ${ICON_SIZES.length} app icons, ground ${toCss(BACKGROUND)}`);
