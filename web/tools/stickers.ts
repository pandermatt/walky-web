/**
 * The iMessage sticker pack: ../ios/Stickers/Stickers.xcstickers.
 *
 * Run with:  npx vite-node tools/stickers.ts
 *
 * Nine stickers, of two kinds.
 *
 * Six are built out of the same primitives as `appIcons.ts` and `iosIcon.ts`,
 * and for the same reason: a pedestrian here is a circle in a goal colour with a
 * white ring, which is what `PedestrianPanel.drawPedestrian` has drawn since
 * 2016, and a wall is a block in a colour `randomBrightColor` could have
 * produced. None of it is traced off a pictogram, so none of it has a provenance
 * anybody has to take on trust -- and if the palette rule changes, the stickers
 * change with it.
 *
 * The other three are 2016 toolbar icons, dropped in whole. See `original`
 * below for which, why those three, and what had to be done to them.
 *
 * Like the icons and the share card, the output is committed and this is not
 * part of `npm run build`. Regenerating is a decision.
 *
 * THE GROUND IS TRANSPARENT, AND THE RING IS RE-TUNED FOR IT.
 *
 * The favicon and the home-screen icon sit on an opaque #1E1E1E tile, because a
 * white ring vanishes on a light tab strip and a dark dot vanishes on a dark
 * one. A sticker cannot take that way out: it is dropped onto somebody's bubble
 * or somebody's photo, and a tile there reads as a screenshot of the app rather
 * than as a sticker of it.
 *
 * So the ground goes away and comes back as an edge. Every mark is drawn over a
 * silhouette of itself in `BACKGROUND`, grown by `KEY` -- the map's own colour,
 * carried as a keyline. It is what makes a white ring survive a white bubble,
 * and it is the one place the pack departs from what the app draws. That is the
 * same kind of departure `STROKE_BOOST` in ogImage.ts already is: a decision
 * about being looked at somewhere else, at a size nobody chose.
 *
 * On the app icon below, where the ground *is* #1E1E1E, that silhouette is
 * invisible -- the keyline and the ground are the same colour, so one helper
 * draws both cases and the icon needs no separate code path.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKGROUND, BLACK, ORANGE, WHITE, shadowOf, toCss, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, RUST, SKY, TEAL } from './brand.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '../ios/Stickers/Stickers.xcstickers');
const PACK = join(OUT, 'Sticker Pack.stickerpack');
const ICONSET = join(OUT, 'iMessage App Icon.stickersiconset');
const ICONS = join(ROOT, 'public/icons');

/**
 * The image size a `regular` grid wants: three stickers to a row.
 *
 * `small` (300) loses the crowd's three rings to each other and `large` (618)
 * gives two-to-a-row billing to marks that are, at bottom, coloured dots. Three
 * across is the width these were drawn at.
 */
const BOX = 408;
const CENTRE = BOX / 2;

/** How far from the centre a mark may reach. */
const REACH = BOX * 0.43;

/** The keyline: the map's ground, carried out to the edge of every mark. */
const KEY = BOX * 0.02;

const f = (n: number) => n.toFixed(2);

type Point = [number, number];

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

const path = (points: Point[]) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z';

/**
 * A block -- a wall, a goal, a generator -- keylined the same way.
 *
 * The silhouette is a stroked copy of the shape rather than an outline on the
 * shape itself, so the keyline lands wholly outside and takes nothing off the
 * fill. `opacity` is for the generator, whose block is short of solid; there the
 * silhouette showing through is exactly right, since what shows through it on
 * the map is the floor.
 */
function block(points: Point[], fill: RGB, opacity = 1): string {
  const d = path(points);
  return `<path d="${d}" fill="${toCss(BACKGROUND)}" stroke="${toCss(BACKGROUND)}"`
    + ` stroke-width="${f(2 * KEY)}" stroke-linejoin="round"/>
  <path d="${d}" fill="${toCss(fill)}" fill-opacity="${opacity}"/>`;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function svg(art: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}"`
    + ` viewBox="0 0 ${BOX} ${BOX}">
  ${art}
</svg>
`;
}

// ---------------------------------------------------------------- the marks

/**
 * The app's own mark: three pedestrians packed into a triangle.
 *
 * The solve is `crowd()` from appIcons.ts, which is where the mark was settled;
 * repeated here rather than imported because that module is a script that writes
 * PNGs on import, and lifting six lines of arithmetic is cheaper than making it
 * importable. If it moves, it moves in both.
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

/**
 * Two files passing: the case the whole model exists to get right.
 *
 * Different colours because they are walking to different goals, offset by half
 * a pitch because two lines that meet head-on interleave rather than collide --
 * which is the behaviour, drawn.
 */
function counterflow(): string {
  // Three abreast per file, which is as many as can be told apart at the size a
  // sticker is actually looked at.
  const r = (2 * REACH - 2 * KEY) / 5.6;
  const ring = r * 0.16;
  const pitch = r * 1.72;
  const rows: string[] = [];
  for (let i = 0; i < 3; i++) {
    rows.push(pedestrian(CENTRE - pitch + i * pitch, CENTRE - r * 0.95, r, TEAL, ring));
  }
  for (let i = 0; i < 3; i++) {
    rows.push(pedestrian(CENTRE - pitch / 2 + i * pitch, CENTRE + r * 0.95, r, LIME, ring));
  }
  return rows.join('\n  ');
}

/**
 * A goal, and a crowd walking into it.
 *
 * The same triangle as the mark, arrived: the two that got there are black,
 * because that is what `Agents` does to a pedestrian on arrival, and the one
 * still behind them is still the colour of where it is going.
 */
function goal(): string {
  const reach = REACH * 0.62;
  const ring = reach * 0.075;
  const r = (reach - ring / 2) / 1.98;
  const R = r * 0.98;
  const dx = R * Math.cos(Math.PI / 6);
  const dy = R * Math.sin(Math.PI / 6);
  // The face of the goal: where a pedestrian stops being one of the crowd.
  const face = CENTRE + REACH * 0.34;
  const cy = face - dy - r - ring / 2 - KEY;
  return [
    block(rect(CENTRE - REACH * 0.95, face, CENTRE + REACH * 0.95, CENTRE + REACH * 0.93), MAGENTA),
    pedestrian(CENTRE, cy - R, r, MAGENTA, ring),
    pedestrian(CENTRE - dx, cy + dy, r, BLACK, ring),
    pedestrian(CENTRE + dx, cy + dy, r, BLACK, ring),
  ].join('\n  ');
}

/**
 * The picture the share card is built around: two walls leaving a gap, and a
 * crowd that cannot reach anything without funnelling through it.
 *
 * The two walls are different colours because they are two walls -- the palette
 * rule gives every one its own draw, and a map where the obstacles happen to
 * match is a map somebody arranged.
 */
function bottleneck(): string {
  const r = REACH * 0.175;
  const ring = r * 0.18;
  const x0 = CENTRE + REACH * 0.08;
  const x1 = CENTRE + REACH * 0.38;
  // The gap is a little wider than a pedestrian and no wider: what makes a queue
  // is that only one of them fits at a time.
  const gap = r + ring + KEY * 2;
  // A wedge, not a line. A crowd arrives on a front and leaves in single file,
  // and the shape between those two is the whole reason a bottleneck is a thing
  // worth simulating.
  const wedge: Point[] = [
    [CENTRE - REACH * 0.8, CENTRE - REACH * 0.72],
    [CENTRE - REACH * 0.8, CENTRE],
    [CENTRE - REACH * 0.8, CENTRE + REACH * 0.72],
    [CENTRE - REACH * 0.48, CENTRE - REACH * 0.38],
    [CENTRE - REACH * 0.48, CENTRE + REACH * 0.38],
    [CENTRE - REACH * 0.16, CENTRE],
    // In the gap, and out the far side.
    [CENTRE + REACH * 0.23, CENTRE],
    [CENTRE + REACH * 0.78, CENTRE],
  ];
  return [
    block(rect(x0, -KEY * 2, x1, CENTRE - gap), RUST),
    block(rect(x0, CENTRE + gap, x1, BOX + KEY * 2), SKY),
    ...wedge.map(([x, y]) => pedestrian(x, y, r, MAGENTA, ring)),
  ].join('\n  ');
}

/**
 * A wall that is not convex, and the crowd going the long way round it.
 *
 * The L is the shape the share card uses to say the same thing, and the reason
 * navigation is a visibility graph rather than a straight line. It is drawn over
 * its own `shadowOf` -- `Color.darker()` twice, which palette.ts still carries
 * as the wall shadow colour from 2016, and which the app itself no longer draws.
 * This is the one place the rule is a picture again.
 */
function detour(): string {
  const a = REACH * 0.72;
  const t = REACH * 0.52;
  const d = REACH * 0.1;
  // Pushed into the bottom-left corner, which is what leaves the open quadrant
  // the crowd walks through big enough to put a crowd in.
  const ox = -REACH * 0.22;
  const oy = REACH * 0.22;
  const ell: Point[] = [
    [CENTRE - a + ox, CENTRE - a + oy], [CENTRE - a + t + ox, CENTRE - a + oy],
    [CENTRE - a + t + ox, CENTRE + a - t + oy], [CENTRE + a + ox, CENTRE + a - t + oy],
    [CENTRE + a + ox, CENTRE + a + oy], [CENTRE - a + ox, CENTRE + a + oy],
  ];
  const shifted = ell.map(([x, y]) => [x + d, y + d] as Point);
  const r = REACH * 0.2;
  const ring = r * 0.18;
  // On the diagonal across the open corner, which is the line the visibility
  // graph actually returns: nobody cuts through, and nobody walks the perimeter.
  const walk: Point[] = [
    [CENTRE - REACH * 0.16, CENTRE - REACH * 0.62],
    [CENTRE + REACH * 0.29, CENTRE - REACH * 0.31],
    [CENTRE + REACH * 0.75, CENTRE],
  ];
  return [
    block(shifted, shadowOf(RUST)),
    block(ell, RUST),
    ...walk.map(([x, y]) => pedestrian(x, y, r, LIME, ring)),
  ].join('\n  ');
}

/**
 * A route: where one pedestrian is going, and the corner it has to take to get
 * there.
 *
 * Orange because that is the colour of the `goal-paths` layer, which is the
 * app's own answer to "show me the way out" -- and the path bends because a
 * visibility graph returns corners, never a curve.
 */
function route(): string {
  const r = REACH * 0.26;
  const ring = r * 0.18;
  const from: Point = [CENTRE - REACH * 0.66, CENTRE + REACH * 0.64];
  const turn = CENTRE + REACH * 0.24;
  const face = CENTRE - REACH * 0.36;
  const line = `M${f(from[0])} ${f(from[1])} L${f(turn)} ${f(from[1])} L${f(turn)} ${f(face)}`;
  return [
    block(rect(CENTRE - REACH * 0.16, CENTRE - REACH * 0.98, CENTRE + REACH * 0.8, face), MAGENTA),
    `<path d="${line}" fill="none" stroke="${toCss(BACKGROUND)}"`
      + ` stroke-width="${f(REACH * 0.11 + 2 * KEY)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${line}" fill="none" stroke="${toCss(ORANGE)}"`
      + ` stroke-width="${f(REACH * 0.11)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    pedestrian(from[0], from[1], r, MAGENTA, ring),
  ].join('\n  ');
}

// ------------------------------------------------------ the 2016 originals

/**
 * Three of the original toolbar icons, dropped in whole.
 *
 * They are the three that are *about* something rather than being a control. A
 * gear or a magnifier is chrome; painting a wall -- a square one, or one traced
 * freehand -- and picking something up are what you do in Walky, and these icons
 * have said so since 2016.
 *
 * THE HALO. Most of the 2016 set is black line art drawn for Swing's light
 * toolbar. It is why the strip in the web app is light and not dark, and on a
 * message bubble it would have the same problem with no strip to fix it.
 * `clear.png` is the one icon in the set that already solved this, by carrying a
 * white outline in the file. So the others are given the same one here, dilated
 * off their own alpha: black art on a light bubble, a white edge on a dark one,
 * and nothing invented that the set did not already do to itself.
 *
 * `addWall` and `addWallSquare` need it least -- they are a cyan shape and a
 * green plus -- but they take it too, because a pack where one sticker is
 * outlined and the next is not looks like two packs.
 */
const HALO = `<defs>
    <filter id="halo" color-interpolation-filters="sRGB"
            x="-15%" y="-15%" width="130%" height="130%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${f(BOX * 0.022)}" result="fat"/>
      <feFlood flood-color="${toCss(WHITE)}"/>
      <feComposite in2="fat" operator="in"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>`;

function original(file: string): string {
  const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  const uri = `data:${mime};base64,${readFileSync(join(ICONS, file)).toString('base64')}`;
  // Inset by the halo's own width, so the outline has somewhere to go.
  const m = BOX * 0.075;
  return `${HALO}
  <image x="${f(m)}" y="${f(m)}" width="${f(BOX - 2 * m)}" height="${f(BOX - 2 * m)}"`
    + ` preserveAspectRatio="xMidYMid meet" filter="url(#halo)" href="${uri}"/>`;
}

// -------------------------------------------------------------- the catalogue

interface Sticker {
  /** The folder, and the PNG inside it. */
  name: string;
  /** What VoiceOver reads in the sticker browser, where there is nothing else to read. */
  label: string;
  art: string;
}

const STICKERS: Sticker[] = [
  { name: 'crowd', label: 'A crowd of three pedestrians', art: crowd(REACH) },
  { name: 'counterflow', label: 'Two crowds walking through each other', art: counterflow() },
  { name: 'goal', label: 'A crowd arriving at a goal', art: goal() },
  { name: 'bottleneck', label: 'A crowd funnelling through a gap between two walls', art: bottleneck() },
  { name: 'detour', label: 'A crowd walking around an L-shaped wall', art: detour() },
  { name: 'route', label: 'A pedestrian and its route to a goal', art: route() },
  { name: 'paint-square', label: 'Paint a square wall', art: original('addWallSquare.png') },
  { name: 'paint-freeform', label: 'Paint a freeform wall', art: original('addWall.png') },
  { name: 'select', label: 'Select', art: original('select.png') },
];

/**
 * The Messages drawer icon, which may not be transparent -- so it is the crowd
 * on the app's own #1E1E1E, exactly as the home screen has it, and the keyline
 * every sticker wears disappears into the ground it was borrowed from.
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

for (const s of STICKERS) {
  const dir = join(PACK, `${s.name}.sticker`);
  mkdirSync(dir, { recursive: true });
  render(s.name, svg(s.art), BOX, BOX, join(dir, `${s.name}.png`));
  writeFileSync(join(dir, 'Contents.json'), json({
    info: INFO,
    properties: { filename: `${s.name}.png`, 'accessibility-label': s.label },
  }));
}

// `stickers` is what fixes the order in the drawer; without it the pack is
// whatever order the catalogue happens to enumerate its folders in.
writeFileSync(join(PACK, 'Contents.json'), json({
  info: INFO,
  properties: { 'grid-size': 'regular' },
  stickers: STICKERS.map((s) => ({ filename: `${s.name}.sticker` })),
}));

for (const i of ICON_SIZES) {
  render(i.file, iconSvg(i.w, i.h), i.w, i.h, join(ICONSET, i.file));
}
writeFileSync(join(ICONSET, 'Contents.json'), json({
  images: ICON_SIZES.map((i) => i.entry),
  info: INFO,
}));

console.log(`${OUT}`);
console.log(`  ${STICKERS.length} stickers at ${BOX}x${BOX}, regular grid`);
console.log(`  ${ICON_SIZES.length} app icons, ground ${toCss(BACKGROUND)}`);
