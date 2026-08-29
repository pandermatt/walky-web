/**
 * Draws the Open Graph share image: public/images/og.png, 1200x630.
 *
 * Run with:  npm run dev  ->  open /tools/ogImage.html  ->  Save
 *
 * The PNG is committed, not built -- regenerating it is a deliberate act, so this
 * is not wired into `npm run build`, and the page it draws on lives outside the
 * bundle's only entry point (see rollupOptions.input) so it never ships.
 *
 * The picture is a real simulation frame. The scenario below is built from the
 * same model helpers the app uses, stepped with the same Agents.step, and drawn
 * from the same state the renderer reads (wall polygons, agents.x/y/color).
 * Nothing here mocks up the look: a wall is the colour the palette rule allows,
 * and an arrived pedestrian is black because Agents made it black.
 *
 * WHY A CANVAS IN A BROWSER, and not a node script.
 *
 * This was an SVG handed to rsvg-convert, and the wordmark on it was a lie: the
 * app's face is Google Sans Flex, which ships as woff2, which fontconfig cannot
 * read -- so the rasteriser fell through to whatever the machine had, and the
 * card went out set in the platform's font rather than Walky's. A browser loads
 * the real file, and `fillText` on a 2D context draws with it. It is also the
 * same primitive the app already sets its labels with (render/overlay.ts), so
 * the text on the card and the text on the map come off one code path in one
 * engine.
 *
 * The cost is that the render is now a browser's, not a library's, so the PNG is
 * reproducible on a machine rather than byte for byte everywhere. What is still
 * pinned is everything upstream of the pixels: the wall colours are named
 * constants rather than randomBrightColor() draws, and Math.random is seeded
 * below, because the behaviour leans on it for tie-breaks. So the crowd in the
 * frame is the same crowd every time. Pedestrian colours need neither -- a
 * pedestrian takes the colour of the goal it is heading for.
 *
 * WHAT IS NOT DRAWN.
 *
 * Every diagnostic the app can switch on: the dashed hulls, the convex parts,
 * the visibility rays, the personal-space rings, the routes to the goals and the
 * readout. All of those are Settings a viewer turns on to understand a map they
 * are working on. A link preview is nobody's working map -- it is glanced at,
 * two inches wide, by someone who has not seen the app yet, and a mat of dashes
 * and orange lines over it reads as clutter rather than as insight. So the card
 * is what the app draws with the debug switches off: walls, goals, and a crowd.
 */
import { Agents, unpackRgb } from '../src/sim/agents.ts';
import { Navigation } from '../src/sim/navigation.ts';
import { SpatialHash } from '../src/sim/spatialHash.ts';
import { DEFAULT_SETTINGS, makeWall, rectanglePolygon, type Wall } from '../src/state/model.ts';
import { BACKGROUND, WHITE, toCss, withAlpha } from '../src/palette.ts';
import { LIME, MAGENTA, RUST, SKY, TEAL } from './brand.ts';

/**
 * Seeds Math.random for the whole page.
 *
 * Behaviour.escape and Behaviour.randomStep draw on it to break ties and to shake
 * a pinned pedestrian loose, so an unseeded run lands the crowd somewhere slightly
 * different every time and the PNG never stops changing. Seeding here rather than
 * threading an RNG through the simulation keeps the shipped code exactly as it
 * runs in the browser -- the randomness is real, it is just replayed.
 *
 * mulberry32: 32-bit state, good enough for jitter, short enough to read.
 */
function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

seedRandom(20160411);

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * The world rectangle the image frames, at the image's aspect ratio.
 *
 * Fixed rather than fitted to the geometry's bounding box: the crowd moves while
 * the simulation runs, so a fitted frame would rescale itself every time the tick
 * count is tuned, and the composition would drift out from under the wordmark.
 */
const FRAME = { x: 0, y: -40, w: 1900, h: (1900 * HEIGHT) / WIDTH };
const SCALE = WIDTH / FRAME.w;

/**
 * Hairlines that read on screen disappear in a link preview scaled down to a
 * thumbnail, so the white ring around a pedestrian is lifted by this much. It is
 * the one place the image departs from what the app draws, and it is about being
 * looked at small rather than panned around.
 */
const STROKE_BOOST = 1.6;

/**
 * Read from DEFAULT_SETTINGS rather than copied out of it. Copies drift: these
 * were transcribed once, and then personalSpace was renamed and its default moved
 * from 30 to 40 while the copy sat here looking correct.
 */
const RADIUS = DEFAULT_SETTINGS.pedestrianRadius;
const PERSONAL = DEFAULT_SETTINGS.personalSpace;
const SPEED = DEFAULT_SETTINGS.speed;

/**
 * Far enough in that the crowd has opened out of its painted block and is packed
 * against the bottleneck, with the leaders already blackened at the goals -- and
 * not so far that everyone has arrived and the picture is a field of black dots.
 * A queue this long is what keeps a tail of the crowd in frame at the left while
 * the front is already arriving on the right.
 */
const TICKS = 700;

/** Wall colours, from the shared brand palette so the card and the icons agree. */
const GAP_TOP = RUST;
const GAP_BOTTOM = SKY;
const DETOUR = LIME;
const GOAL_UPPER = MAGENTA;
const GOAL_LOWER = TEAL;

function buildWorld(): { walls: Wall[]; nav: Navigation; goals: Wall[] } {
  // Two walls leaving a gap in the middle of the frame: the crowd cannot reach
  // anything without funnelling through it.
  const gapTop = makeWall([rectanglePolygon([880, -60], [1000, 300])], { color: GAP_TOP });
  const gapBottom = makeWall([rectanglePolygon([880, 530], [1000, 1060])], { color: GAP_BOTTOM });

  // An L, so the frame shows a wall that is not convex -- which the crowd has to
  // walk around, and now says so by the shape of the crowd rather than by an
  // outline drawn over it.
  const detour = makeWall([[
    [1210, 280], [1500, 280], [1500, 370], [1300, 370], [1300, 610], [1210, 610],
  ]], { color: DETOUR });

  // Two goals, so the crowd carries two colours instead of one and it fans out
  // past the detour rather than converging on a single point.
  const goalUpper = makeWall([rectanglePolygon([1690, 70], [1850, 250])], { color: GOAL_UPPER });
  const goalLower = makeWall([rectanglePolygon([1690, 500], [1850, 680])], { color: GOAL_LOWER });
  goalUpper.isGoal = true;
  goalLower.isGoal = true;

  const walls = [gapTop, gapBottom, detour, goalUpper, goalLower];
  const nav = new Navigation();
  nav.rebuild(walls, RADIUS);
  return { walls, nav, goals: [goalUpper, goalLower] };
}

function buildCrowd(nav: Navigation, goals: Wall[]): Agents {
  const agents = new Agents();
  // The pitch the pedestrian brush uses: shoulder to shoulder, and left to sort
  // itself out. A crowd opens out to the room it wants within a second of being
  // let go, so painting it packed is what the app actually does now -- and a
  // packed block breaks its own formation as it breathes, which is why nothing
  // here has to jitter the start to stop it marching in lockstep rows.
  const pitch = 2 * RADIUS;
  const cols = 34;
  const rows = 16;
  // Started left of the gap: by the time the frame is taken the block has opened
  // out and packed against the bottleneck, which is the picture worth showing --
  // a crowd still sitting in its painted square is just a block of dots.
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([-900 + i * pitch, 210 + j * pitch]);
      // Split by row so both goals pull from the full height of the block and
      // the two colours interleave on the way to the gap.
      const goal = goals[j % 2];
      agents.setGoal(k, goal.id, goal.color);
    }
  }

  const hash = new SpatialHash();
  for (let t = 0; t < TICKS; t++) agents.step(nav, hash, SPEED, RADIUS, PERSONAL);
  return agents;
}

/** A screen-space width, expressed in the world units the scaled context draws in. */
const world = (px: number) => (px * STROKE_BOOST) / SCALE;

/**
 * The map: walls first, then the crowd over them.
 *
 * Mirrors render/scene.ts with every diagnostic layer switched off, which leaves
 * two of its five: the wall fills, and a pedestrian as a dot in its goal's colour
 * inside a white ring.
 */
function drawMap(ctx: CanvasRenderingContext2D, walls: Wall[], agents: Agents): void {
  ctx.save();
  ctx.scale(SCALE, SCALE);
  ctx.translate(-FRAME.x, -FRAME.y);

  for (const wall of walls) {
    ctx.fillStyle = toCss(wall.color);
    for (const polygon of wall.polygons) {
      ctx.beginPath();
      polygon.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.strokeStyle = toCss(WHITE);
  ctx.lineWidth = world(1);
  for (let i = 0; i < agents.count; i++) {
    ctx.fillStyle = toCss(unpackRgb(agents.color[i]));
    ctx.beginPath();
    ctx.arc(agents.x[i], agents.y[i], RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/** The app's stack, from --wk-font-family in ui/theme.ts. */
const FAMILY = "'Google Sans Flex', system-ui, -apple-system, sans-serif";

/**
 * The wordmark, bottom-left over a scrim.
 *
 * The scrim exists because a wall can land anywhere: the crowd and the walls are
 * whatever the simulation produced, so the text cannot rely on what is behind it.
 *
 * The weights are the face's own axis -- it is variable from 100 to 1000 -- so
 * 700 here is a real cut rather than a browser thickening 400 on its own.
 */
function drawWordmark(ctx: CanvasRenderingContext2D): void {
  const scrim = ctx.createLinearGradient(0, HEIGHT, 0, HEIGHT - 210);
  scrim.addColorStop(0, withAlpha(BACKGROUND, 0.96));
  scrim.addColorStop(1, withAlpha(BACKGROUND, 0));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, HEIGHT - 210, WIDTH, 210);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `700 78px ${FAMILY}`;
  ctx.letterSpacing = '-1.5px';
  ctx.fillStyle = toCss(WHITE);
  ctx.fillText('Walky', 64, HEIGHT - 92);

  ctx.font = `400 27px ${FAMILY}`;
  ctx.letterSpacing = '0px';
  ctx.fillStyle = withAlpha(WHITE, 0.72);
  ctx.fillText('A pedestrian simulator that runs entirely in the browser.', 64, HEIGHT - 50);
}

/**
 * Loads the app's own typeface into this page.
 *
 * ui/theme.ts declares the same @font-face, but with a URL relative to the
 * document -- correct for the app at the root, and a 404 for a page under
 * /tools/. This asks for the file by its path from the root instead.
 *
 * Awaited rather than fired off, and allowed to throw: a canvas whose font has
 * not arrived draws in the fallback face without a word of complaint, which is
 * the exact failure this whole page exists to end.
 */
async function loadFont(): Promise<void> {
  const face = new FontFace(
    'Google Sans Flex',
    "url('/fonts/google-sans-flex-latin.woff2') format('woff2')",
    { weight: '100 1000' },
  );
  await face.load();
  document.fonts.add(face);
}

/** The path build/ogWriter.ts listens on. A mismatch shows up as a 404 on Save. */
const ENDPOINT = '/__walky/og.png';

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/png');
  });
}

const canvas = document.querySelector<HTMLCanvasElement>('#card')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

async function main(): Promise<void> {
  await loadFont();

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = toCss(BACKGROUND);
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const { walls, nav, goals } = buildWorld();
  const agents = buildCrowd(nav, goals);
  drawMap(ctx, walls, agents);
  drawWordmark(ctx);

  let arrived = 0;
  for (let i = 0; i < agents.count; i++) if (agents.arrived[i]) arrived++;
  status.textContent = `${WIDTH}x${HEIGHT} -- ${agents.count} pedestrians, `
    + `${arrived} arrived after ${TICKS} ticks`;
  saveButton.disabled = false;

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    const response = await fetch(ENDPOINT, { method: 'POST', body: await toBlob(canvas) });
    status.textContent = response.ok
      ? `Wrote ${await response.text()} bytes`
      : `Save failed: ${response.status} ${await response.text()}`;
    saveButton.disabled = false;
  });
}

main().catch((error: unknown) => {
  status.textContent = `${error}`;
});
