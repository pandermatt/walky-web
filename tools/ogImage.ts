/**
 * Renders the Open Graph share image: public/images/og.png, 1200x630.
 *
 * Run with:  npx vite-node tools/ogImage.ts
 *
 * The PNG is committed, not built -- regenerating it is a deliberate act, so this
 * is not wired into `npm run build`.
 *
 * The picture is a real simulation frame. The scenario below is built from the
 * same model helpers the app uses, stepped with the same Agents.step, and drawn
 * from the same state the renderer reads (nav.shells, nav.obstacles,
 * nav.pathFromNode, agents.x/y/color). Nothing here mocks up the look: a wall is
 * the colour the palette rule allows, an arrived pedestrian is black because
 * Agents made it black, and the routes are whatever Dijkstra returned.
 *
 * A re-run reproduces the frame byte for byte, so a diff on the PNG means the render
 * actually changed. That takes two things: the wall colours are named constants
 * rather than randomBrightColor() draws, and Math.random is seeded below, because
 * the behaviour leans on it for tie-breaks. Pedestrian colours need neither -- a
 * pedestrian takes the colour of the goal it is heading for.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agents, unpackRgb } from '../src/sim/agents.ts';
import { Navigation } from '../src/sim/navigation.ts';
import { SpatialHash } from '../src/sim/spatialHash.ts';
import type { Point } from '../src/sim/geometry.ts';
import { DEFAULT_SETTINGS, makeWall, rectanglePolygon, type Wall } from '../src/state/model.ts';
import { DASH } from '../src/render/overlay.ts';
import { BACKGROUND, ORANGE, WHITE, toCss, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, RUST, SKY, TEAL } from './brand.ts';

/**
 * Seeds Math.random for the whole script.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PNG = join(ROOT, 'public/images/og.png');

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
 * thumbnail, so screen-space stroke widths are lifted by this much. Weight only:
 * the dash rhythm is converted straight from DASH and left alone, so the outlines
 * keep the 9-on-9-off cadence the original stroked them with.
 *
 * This and PATH_LIMIT are the only two places the image departs from what the app
 * draws, and both are about being looked at small rather than panned around.
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

/**
 * How many routes to draw.
 *
 * App.goalPaths caps at 1500 on the reasoning that past some number of routes the
 * picture is an unreadable mat of lines. The same judgement lands on a much lower
 * number here: a route is 2px wide whether it is on a canvas you can pan and zoom
 * or a share card someone glances at. The cap is applied by taking every nth
 * agent, so the routes that survive are spread through the crowd rather than
 * clustered at whichever end was added first.
 */
const PATH_LIMIT = 22;

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

  // An L, so the frame shows a wall that is not convex. Its whole-wall hull is
  // drawn solid and its two convex parts faintly, which is the split the
  // navigation actually works on.
  const detour = makeWall([[
    [1210, 280], [1500, 280], [1500, 370], [1300, 370], [1300, 610], [1210, 610],
  ]], { color: DETOUR });

  // Two goals, so the crowd carries two colours instead of one and the routes
  // fan out past the detour rather than converging on a single point.
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

/**
 * The routes the overlay would draw: mirrors App.goalPaths, under a tighter cap.
 *
 * The image is a paused frame, so this takes App's not-running branch -- an agent
 * without a remembered waypoint gets its route predicted with routeFrom rather
 * than being skipped. That is what the app puts on screen the moment you hit
 * pause, which is the state this picture is in.
 */
function goalPaths(agents: Agents, nav: Navigation): Point[][] {
  const out: Point[][] = [];
  const stride = Math.max(1, Math.ceil(agents.count / PATH_LIMIT));
  for (let i = 0; i < agents.count; i += stride) {
    if (agents.arrived[i]) continue;
    const goalId = agents.goal[i];
    if (goalId < 0) continue;
    const head: Point = [agents.x[i], agents.y[i]];
    let path: Point[];
    if (agents.hasWaypoint[i]) {
      const rest = nav.pathFromNode(agents.waypointNode[i], goalId);
      path = rest.length > 0
        ? [head, ...rest]
        : [head, [agents.waypointX[i], agents.waypointY[i]]];
    } else {
      path = nav.routeFrom(head, goalId);
    }
    if (path.length >= 2) out.push(path);
  }
  return out;
}

/**
 * The hull outlines to draw: mirrors App.expandedHulls. Convex parts go first and
 * faintly, the whole-wall shells over them at full strength.
 */
function expandedHulls(walls: Wall[], nav: Navigation): { points: Point[]; color: RGB; faint: boolean }[] {
  const byId = new Map(walls.map((w) => [w.id, w.color]));
  const parts = nav.obstacles.map((ob) => ({
    points: ob.hull, color: byId.get(ob.wallId) ?? WHITE, faint: true,
  }));
  const shells = nav.shells.map((sh) => ({
    points: sh.hull, color: byId.get(sh.wallId) ?? WHITE, faint: false,
  }));
  return [...parts, ...shells];
}

const round = (v: number) => Math.round(v * 10) / 10;
const points = (pts: Point[]) => pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

/** A screen-space width, expressed in the world units the scaled group draws in. */
const world = (px: number) => round((px * STROKE_BOOST) / SCALE);

function buildSvg(walls: Wall[], nav: Navigation, agents: Agents): string {
  const hulls = expandedHulls(walls, nav);
  const paths = goalPaths(agents, nav);
  const dash = DASH.map((d) => round(d / SCALE)).join(' ');

  const wallShapes = walls
    .flatMap((w) => w.polygons.map((polygon) => ({ polygon, color: w.color })))
    .map((piece) => `<polygon points="${points(piece.polygon)}" fill="${toCss(piece.color)}"/>`)
    .join('\n      ');

  const hullShapes = hulls
    .map((h) => `<polygon points="${points(h.points)}" fill="none" stroke="${toCss(h.color)}"`
      + ` stroke-opacity="${h.faint ? 0.35 : 1}" stroke-width="${world(1)}" stroke-dasharray="${dash}"/>`)
    .join('\n      ');

  const pathShapes = paths
    .map((p) => `<polyline points="${points(p)}" fill="none" stroke="${toCss(ORANGE)}"`
      + ` stroke-width="${world(2)}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('\n      ');

  const dots: string[] = [];
  for (let i = 0; i < agents.count; i++) {
    dots.push(`<circle cx="${round(agents.x[i])}" cy="${round(agents.y[i])}" r="${RADIUS}"`
      + ` fill="${toCss(unpackRgb(agents.color[i]))}" stroke="${toCss(WHITE)}" stroke-width="${world(1)}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${toCss(BACKGROUND)}"/>
  <g transform="scale(${SCALE}) translate(${-FRAME.x} ${-FRAME.y})">
    <g>
      ${wallShapes}
    </g>
    <g>
      ${hullShapes}
    </g>
    <g>
      ${pathShapes}
    </g>
    <g>
      ${dots.join('\n      ')}
    </g>
  </g>
${wordmark()}
</svg>
`;
}

/**
 * The wordmark, bottom-left over a scrim.
 *
 * The scrim exists because a wall can land anywhere: the crowd and the walls are
 * whatever the simulation produced, so the text cannot rely on what is behind it.
 */
function wordmark(): string {
  // The app's stack, from --wk-font-family in theme.ts. Google Sans Flex ships as
  // woff2, which fontconfig cannot read, so the rasteriser falls through to the
  // platform's own face -- the same fallback the page uses before the font lands.
  const font = "'Google Sans Flex', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
  return `  <defs>
    <linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${toCss(BACKGROUND)}" stop-opacity="0.96"/>
      <stop offset="1" stop-color="${toCss(BACKGROUND)}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${HEIGHT - 210}" width="${WIDTH}" height="210" fill="url(#scrim)"/>
  <text x="64" y="${HEIGHT - 92}" font-family="${font}" font-size="78" font-weight="700"
        fill="${toCss(WHITE)}" letter-spacing="-1.5">Walky</text>
  <text x="64" y="${HEIGHT - 50}" font-family="${font}" font-size="27" font-weight="400"
        fill="${toCss(WHITE)}" fill-opacity="0.72">A pedestrian simulator that runs entirely in the browser.</text>`;
}

const { walls, nav, goals } = buildWorld();
const agents = buildCrowd(nav, goals);
const svg = buildSvg(walls, nav, agents);

// The SVG is scratch, not an artifact: anything under public/ would be copied
// into dist and shipped alongside the PNG for no reason.
const svgPath = join(tmpdir(), 'walky-og.svg');
mkdirSync(dirname(OUT_PNG), { recursive: true });
writeFileSync(svgPath, svg);

// librsvg rasterises the SVG. It is a local tool, not a dependency: the PNG it
// produces is what ships, so nothing at build or run time needs it.
execFileSync('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', OUT_PNG, svgPath]);

let arrived = 0;
for (let i = 0; i < agents.count; i++) if (agents.arrived[i]) arrived++;
console.log(`og.png  ${WIDTH}x${HEIGHT}  ${agents.count} pedestrians, ${arrived} arrived after ${TICKS} ticks`);
