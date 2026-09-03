/**
 * Draws the Walky wallpapers: four pictures, each at a desktop and a phone size.
 *
 * Run with:  npm run dev  ->  open /tools/wallpapers.html  ->  Save all
 *
 * Every picture is a real simulation frame. The worlds below are built from the
 * same model helpers the app uses, stepped with the same Agents.step, and drawn
 * from the same state the renderer reads -- wall polygons, agents.x/y/color, the
 * visibility graph the navigation is actually routing over. Nothing here mocks up
 * the look: a wall is a colour the palette rule allows, a pedestrian is a dot in
 * the colour of the goal it is heading for, and the lanes in Counterflow are
 * there because the crowd formed them rather than because they were drawn.
 *
 * WHY A CANVAS IN A BROWSER, and not a node script: see tools/ogImage.ts. There
 * is no type on these, so the font argument does not apply -- what does is that
 * a node script would need a canvas library, and @napi-rs/canvas installs 33MB
 * of native binary, a third again as much as deck.gl, into every `npm ci` for a
 * tool that is run by hand once a year. The browser is already here.
 *
 * WHERE THEY GO. Not public/: the service worker precaches everything under it,
 * so committing twenty megabytes of wallpaper there would have Walky pull the
 * lot down the first time anyone opened the app. They are written to
 * `wallpapers/` (ignored) and committed to the site that serves them --
 * pandermatt.ch. See build/wallpaperWriter.ts.
 *
 * WHAT MAKES A WALLPAPER RATHER THAN A SCREENSHOT. Three things, and they are
 * the only places these depart from what the app draws:
 *
 *  - No chrome, no text, no wordmark. It sits behind somebody's work.
 *  - The frame is a crop, not a fit. Walls run off every edge, so the picture
 *    reads as a piece of somewhere larger rather than as a diagram centred on
 *    a slide.
 *  - Hairlines are scaled. A 1px white ring is a 1px ring whatever the canvas
 *    is; at 3840 across it would be a thread. Every stroke width here is given
 *    in world units and scales with the picture, so the ring is the same
 *    fraction of a pedestrian at both sizes.
 */
import { Agents, unpackRgb } from '../src/sim/agents.ts';
import { Navigation } from '../src/sim/navigation.ts';
import { SpatialHash } from '../src/sim/spatialHash.ts';
import { DEFAULT_SETTINGS, makeWall, rectanglePolygon, type Wall } from '../src/state/model.ts';
import { buildVisibilityGraph } from '../src/sim/visibilityGraph.ts';
import { groupWalls } from '../src/state/groups.ts';
import { expandPolygon, type Point } from '../src/sim/geometry.ts';
import { pxPerTickFromMps } from '../src/sim/units.ts';
import { DASH } from '../src/render/overlay.ts';
import { BACKGROUND, BLUE, ORANGE, WHITE, toCss, withAlpha, type RGB } from '../src/palette.ts';
import { LIME, MAGENTA, RUST, SKY, TEAL } from './brand.ts';

/**
 * Seeds Math.random for the whole page -- mulberry32, as in tools/ogImage.ts.
 *
 * Behaviour leans on it to break ties and to shake a pinned pedestrian loose, so
 * an unseeded run lands the crowd somewhere slightly different every time and the
 * pictures never stop changing. The randomness is real; it is just replayed.
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

/**
 * Read from DEFAULT_SETTINGS rather than copied out of it: a copy of `speed`
 * sat in ogImage.ts through the rename that moved it from px/tick to m/s, and
 * went on looking correct while quietly walking its crowd at a fifth of a stroll.
 */
const RADIUS = DEFAULT_SETTINGS.pedestrianRadius;
const PERSONAL = DEFAULT_SETTINGS.personalSpace;
/** The setting is in metres per second; the model spends pixels per tick. */
const SPEED = pxPerTickFromMps(DEFAULT_SETTINGS.speed);

/** The pitch the pedestrian brush paints at: shoulder to shoulder. */
const PITCH = 2 * RADIUS;

export interface Size {
  id: string;
  w: number;
  h: number;
}

/**
 * The two shapes, and only two.
 *
 * 3840x2160 covers every 16:9 desktop by downscaling rather than by stretching,
 * which is what a wallpaper is asked to survive. 1290x2796 is the iPhone Pro
 * panel and the tallest common phone, so it crops rather than letterboxes on
 * anything squarer.
 */
const SIZES: Size[] = [
  { id: 'desktop', w: 3840, h: 2160 },
  { id: 'phone', w: 1290, h: 2796 },
];

/**
 * The window on the world, in world units, given as a width along world x and a
 * centre.
 *
 * A portrait picture takes the same window turned a quarter turn rather than a
 * second scenario built vertically: the crowd then walks up the phone instead of
 * across the desktop, out of the identical simulation. `across` is therefore
 * always measured along world x -- on a phone it lands on the long edge.
 */
interface View {
  centre: Point;
  across: number;
}

interface Scene {
  slug: string;
  /** What it is, for the page and for whoever writes the alt text. */
  title: string;
  desktop: View;
  phone: View;
  /** Everything drawn, in world coordinates. `hair` is one screen pixel. */
  paint(ctx: CanvasRenderingContext2D, hair: number): void;
}

/* ------------------------------------------------------------------ drawing */

function fillWalls(ctx: CanvasRenderingContext2D, walls: Wall[]): void {
  for (const wall of walls) {
    ctx.fillStyle = toCss(wall.color);
    for (const polygon of wall.polygons) {
      ctx.beginPath();
      polygon.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * The crowd, exactly as render/scene.ts draws it: a filled dot in the colour of
 * the goal it is heading for, inside a white ring.
 *
 * The ring is the one thing given a width here rather than taken from the app,
 * for the reason in the header: the app's is a screen pixel and this canvas has
 * a great many more of them than a screen does.
 */
function drawCrowd(ctx: CanvasRenderingContext2D, agents: Agents, hair: number): void {
  ctx.lineWidth = 1.6 * hair;
  ctx.strokeStyle = toCss(WHITE);
  for (let i = 0; i < agents.count; i++) {
    ctx.fillStyle = toCss(unpackRgb(agents.color[i]));
    ctx.beginPath();
    ctx.arc(agents.x[i], agents.y[i], RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

/** A closed dashed outline, the way overlay.ts draws a hull. */
function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/* ---------------------------------------------------------------- scenarios */

/** Runs a crowd for `ticks`, feeding the navigation the same recost the app does. */
function settle(agents: Agents, nav: Navigation, ticks: number): void {
  const hash = new SpatialHash();
  for (let t = 0; t < ticks; t++) {
    agents.step(nav, hash, SPEED, RADIUS, PERSONAL);
    nav.recost(hash, agents.x, agents.y, agents.count);
  }
}

/** A block of pedestrians painted the way the brush paints one, all bound for `goal`. */
function paintBlock(
  agents: Agents,
  goal: Wall,
  origin: Point,
  cols: number,
  rows: number,
  pitch = PITCH,
): void {
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([origin[0] + i * pitch, origin[1] + j * pitch]);
      agents.setGoal(k, goal.id, goal.color);
    }
  }
}

function goalWall(polygon: Point[], color: RGB): Wall {
  const wall = makeWall([polygon], { color });
  wall.isGoal = true;
  return wall;
}

/**
 * 1. Bottleneck -- a crowd pressed through a gap it cannot all fit through.
 *
 * The picture the whole model is about: the queue arches over the opening, the
 * pressure is highest at the front against the barrier, and the two colours
 * interleave because both goals pull from the full height of the block. The
 * arch, the spacing tightening towards the gap and the plume fanning out beyond
 * it are the crowd's doing, not the composition's.
 *
 * The goals are off the right-hand edge on purpose. A pedestrian that reaches
 * one turns black and stops, and a wallpaper does not want a heap of black dots
 * in the corner -- so the frame ends before they get there and what is in it is
 * all crowd that is still walking.
 */
function bottleneck(): Scene {
  seedRandom(20160411);

  const top = makeWall([rectanglePolygon([1300, -1600], [1460, -150])], { color: RUST });
  const bottom = makeWall([rectanglePolygon([1300, 150], [1460, 1600])], { color: SKY });
  // A 300px opening: five and a half body widths, or 5.4m at the model's scale.
  const upper = goalWall(rectanglePolygon([3500, -900], [3700, -600]), MAGENTA);
  const lower = goalWall(rectanglePolygon([3500, 600], [3700, 900]), TEAL);
  const walls = [top, bottom, upper, lower];

  const nav = new Navigation();
  nav.rebuild(walls, RADIUS);

  const agents = new Agents();
  // Painted as one block and split by row, so both goals pull from the full
  // height of it and the colours are mixed through the queue rather than sorted
  // into two halves of it before anyone has walked anywhere.
  const cols = 30;
  const rows = 46;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([120 + i * PITCH, -598 + j * PITCH]);
      const goal = j % 2 === 0 ? upper : lower;
      agents.setGoal(k, goal.id, goal.color);
    }
  }
  // Forty seconds of simulated time. Long enough that the arch has formed and
  // the plume beyond the gap reaches the right-hand edge; short enough that the
  // queue behind it is still a queue rather than a thinning tail.
  settle(agents, nav, 2400);

  return {
    slug: 'bottleneck',
    title: 'A crowd pressed through a gap',
    desktop: { centre: [1180, 0], across: 3100 },
    phone: { centre: [1240, 0], across: 2600 },
    paint(ctx, hair) {
      fillWalls(ctx, walls);
      drawCrowd(ctx, agents, hair);
    },
  };
}

/**
 * 2. Counterflow -- two crowds walking through each other, and the lanes they
 *    form doing it.
 *
 * Lane formation is the field's canonical emergent result and the one thing in a
 * crowd model that cannot be faked convincingly: the stripes are as wide as the
 * passing rule and the anisotropy make them, they bend around each other, and
 * they are wider in the middle of the corridor than against its walls. Nothing
 * here separates the two streams. They start as two solid blocks filling the
 * corridor end to end, are sent to opposite ends of it, and sort themselves out.
 */
function counterflow(): Scene {
  seedRandom(0x5eed01);

  const north = makeWall([rectanglePolygon([-5200, -900], [5200, -740])], { color: LIME });
  const south = makeWall([rectanglePolygon([-5200, 740], [5200, 900])], { color: RUST });
  const east = goalWall(rectanglePolygon([4800, -740], [5000, 740]), MAGENTA);
  const west = goalWall(rectanglePolygon([-5000, -740], [-4800, 740]), TEAL);
  const walls = [north, south, east, west];

  const nav = new Navigation();
  nav.rebuild(walls, RADIUS);

  // One block filling the corridor, with the two destinations interleaved
  // through it as a checkerboard rather than painted as two crowds meeting.
  //
  // Two blocks would only be walking through each other while their fronts
  // overlapped, and the picture would be mostly two solid colours with a seam
  // between them. Mixed from the start, every part of the corridor is
  // bidirectional, and the lanes are the only structure in the frame -- so a
  // stripe in it is unambiguously something the crowd did, since what it was
  // given was the opposite of a stripe.
  //
  // The block is far longer than the frame, and the goals are beyond both its
  // ends, so the crowd walking out of the picture is replaced by crowd walking
  // in rather than by empty floor.
  const SPACING = 46;
  const agents = new Agents();
  const cols = 180;
  const rows = 31;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([-4140 + i * SPACING, -690 + j * SPACING]);
      const goal = (i + j) % 2 === 0 ? east : west;
      agents.setGoal(k, goal.id, goal.color);
    }
  }
  // Twenty seconds. Long enough for the lanes to form and straighten; short
  // enough that they have not yet coarsened into two halves of the corridor,
  // which is where a long bidirectional run eventually settles.
  settle(agents, nav, 1200);

  return {
    slug: 'counterflow',
    title: 'Two crowds walking through each other',
    desktop: { centre: [0, 0], across: 3400 },
    phone: { centre: [0, 0], across: 2700 },
    paint(ctx, hair) {
      fillWalls(ctx, walls);
      drawCrowd(ctx, agents, hair);
    },
  };
}

/**
 * 3. Sightlines -- the navigation itself, with barely a crowd on it.
 *
 * The one picture here that draws the machinery rather than the result. The
 * dashed outlines are each connected group's hull expanded by the pedestrian
 * radius -- the boundary a centre may not cross. The blue web is the visibility
 * graph Dijkstra actually runs over: an edge exists exactly where one expanded
 * corner can see another, which is why the web is dense in the open and thins to
 * nothing behind a wall. The orange lines are routes read back out of the
 * finished field. All three come from the same `buildVisibilityGraph` call the
 * navigation makes, not from a sketch of one.
 *
 * Quiet on purpose. A desktop has icons and windows on it, and this is the one
 * here with floor left to put them on.
 */
function sightlines(): Scene {
  seedRandom(0x51687);

  const pillar = makeWall([rectanglePolygon([-1560, -880], [-1140, -460])], { color: SKY });
  const bar = makeWall([rectanglePolygon([-780, 220], [340, 440])], { color: LIME });
  // An L and a T, so the graph has to route around shapes that are not convex --
  // which is the case the whole convex decomposition exists for.
  const ell = makeWall([[
    [700, -940], [1500, -940], [1500, -680], [980, -680], [980, 40], [700, 40],
  ]], { color: RUST });
  const tee = makeWall([[
    [-260, -880], [-40, -880], [-40, -560], [520, -560], [520, -340], [-260, -340],
  ]], { color: MAGENTA });
  const block = makeWall([rectanglePolygon([-1700, 380], [-1300, 1000])], { color: TEAL });
  const post = makeWall([rectanglePolygon([840, 560], [1120, 840])], { color: SKY });
  const goal = goalWall(rectanglePolygon([1860, 120], [2160, 460]), MAGENTA);
  const walls = [pillar, bar, ell, tee, block, post, goal];

  const nav = new Navigation();
  nav.rebuild(walls, RADIUS);
  const graph = buildVisibilityGraph(walls, RADIUS);

  // The outlines the app draws with "Convex hull" on: one per connected group,
  // expanded by the radius, in the group's own colour.
  const byId = new Map(walls.map((w) => [w.id, w.color]));
  const hulls = groupWalls(walls).map((g) => ({
    points: expandPolygon(g.hull, RADIUS),
    color: byId.get(g.wallIds[0]) ?? WHITE,
  }));

  // A thin crowd, spread out: enough that the routes are somebody's rather than
  // nobody's, and loose enough that each one is walking rather than queueing.
  const agents = new Agents();
  paintBlock(agents, goal, [-1820, -700], 4, 6, 4 * RADIUS);
  paintBlock(agents, goal, [-1500, 1180], 5, 3, 4 * RADIUS);
  paintBlock(agents, goal, [-200, 900], 4, 3, 4 * RADIUS);
  paintBlock(agents, goal, [-120, -1220], 5, 3, 4 * RADIUS);
  paintBlock(agents, goal, [1180, -1180], 4, 3, 4 * RADIUS);
  settle(agents, nav, 360);

  // Routes read back out of the finished field, from where the walkers are now.
  // Every fifth, not every one: sixty routes down one corridor is a bundle, and
  // a bundle says nothing a single line does not.
  const routes: Point[][] = [];
  for (let i = 0; i < agents.count; i += 3) {
    const route = nav.routeFrom([agents.x[i], agents.y[i]], goal.id);
    if (route.length > 2) routes.push(route);
  }

  return {
    slug: 'sightlines',
    title: 'The visibility graph the crowd routes over',
    desktop: { centre: [140, 20], across: 4000 },
    phone: { centre: [240, 20], across: 3200 },
    paint(ctx, hair) {
      // The web first, and faintly: it is the ground the rest stands on, and at
      // full strength a few hundred straight lines flatten everything over them.
      ctx.strokeStyle = withAlpha(BLUE, 0.75);
      ctx.lineWidth = 1.8 * hair;
      ctx.beginPath();
      const { offsets, targets } = graph.csr;
      for (let u = 0; u < graph.nodes.length; u++) {
        for (let e = offsets[u]; e < offsets[u + 1]; e++) {
          const v = targets[e];
          // Each edge appears twice in a CSR built from an undirected graph.
          if (v <= u) continue;
          ctx.moveTo(graph.nodes[u][0], graph.nodes[u][1]);
          ctx.lineTo(graph.nodes[v][0], graph.nodes[v][1]);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = withAlpha(ORANGE, 0.85);
      ctx.lineWidth = 3.4 * hair;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const route of routes) {
        ctx.beginPath();
        route.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      }

      fillWalls(ctx, walls);

      ctx.save();
      // The dash is quoted in screen pixels in overlay.ts, where a map is looked
      // at from a metre away; this is looked at from across a room.
      ctx.setLineDash(DASH.map((d) => d * hair * 2.5));
      ctx.lineWidth = 2 * hair;
      for (const hull of hulls) {
        ctx.strokeStyle = withAlpha(hull.color, 0.8);
        tracePolygon(ctx, hull.points);
        ctx.stroke();
      }
      ctx.restore();

      // The graph's corners, so the web reads as a graph rather than as a mesh.
      ctx.fillStyle = withAlpha(WHITE, 0.9);
      for (const [x, y] of graph.nodes) {
        ctx.beginPath();
        ctx.arc(x, y, 4 * hair, 0, 2 * Math.PI);
        ctx.fill();
      }

      drawCrowd(ctx, agents, hair);
    },
  };
}

/**
 * 4. Trails -- where a crowd went, rather than where it is.
 *
 * A long exposure. Every pedestrian's position is sampled through the whole run
 * and its track stroked at low alpha, additively, so a thread is faint where one
 * person walked and bright where two hundred took the same line. The braid at
 * each gap, the wake behind each obstacle and the shear where the two colours
 * cross are an integral of the paths actually taken rather than a smoothing of
 * them -- which is why the bright lines do not sit where the shortest route is:
 * they sit where the route was cheapest once the crowd on it was priced in.
 *
 * Strokes, not stamps. A dot per pedestrian per tick is half a million circles
 * and comes out as a dotted mist; a polyline per pedestrian is seven hundred
 * paths and comes out as a line, which is what a track is.
 */
function trails(): Scene {
  seedRandom(0x7a11e5);

  const obstacles: Wall[] = [
    makeWall([rectanglePolygon([-620, -1500], [-420, -320])], { color: SKY }),
    makeWall([rectanglePolygon([-620, 60], [-420, 1240])], { color: LIME }),
    makeWall([rectanglePolygon([380, -1000], [580, 220])], { color: RUST }),
    makeWall([rectanglePolygon([380, 640], [580, 1800])], { color: MAGENTA }),
    makeWall([rectanglePolygon([1340, -1800], [1540, -420])], { color: LIME }),
    makeWall([rectanglePolygon([1340, -40], [1540, 1400])], { color: SKY }),
  ];
  const upper = goalWall(rectanglePolygon([2760, -900], [2960, -560]), MAGENTA);
  const lower = goalWall(rectanglePolygon([2760, 560], [2960, 900]), TEAL);
  const walls = [...obstacles, upper, lower];

  const nav = new Navigation();
  nav.rebuild(walls, RADIUS);

  const agents = new Agents();
  const cols = 16;
  const rows = 44;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = agents.add([-2020 + i * PITCH, -572 + j * PITCH]);
      const goal = j % 2 === 0 ? upper : lower;
      agents.setGoal(k, goal.id, goal.color);
    }
  }

  // The exposure: one track per pedestrian, sampled every eighth tick. At a
  // walking pace that is a sample every ten pixels, which is under a body
  // radius -- fine enough that a stroked track is a curve rather than a chain of
  // chords, and coarse enough to keep the whole run in a few megabytes.
  const SAMPLE = 8;
  const tracks: number[][] = Array.from({ length: agents.count }, () => []);
  const hash = new SpatialHash();
  for (let t = 0; t < 3600; t++) {
    agents.step(nav, hash, SPEED, RADIUS, PERSONAL);
    nav.recost(hash, agents.x, agents.y, agents.count);
    if (t % SAMPLE !== 0) continue;
    for (let i = 0; i < agents.count; i++) {
      // An arrived pedestrian stands on its goal for the rest of the run; a
      // track that goes on recording it just piles samples on one point.
      if (agents.arrived[i]) continue;
      tracks[i].push(agents.x[i], agents.y[i]);
    }
  }
  const colors = Array.from({ length: agents.count }, (_, i) => unpackRgb(agents.color[i]));

  return {
    slug: 'trails',
    title: 'A long exposure of where a crowd went',
    desktop: { centre: [220, -30], across: 4700 },
    phone: { centre: [320, -30], across: 3900 },
    paint(ctx, hair) {
      // Additive, so two hundred faint tracks down one line make a bright line
      // rather than settling at the alpha of the last one drawn.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2.2 * hair;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.length < 4) continue;
        ctx.strokeStyle = withAlpha(colors[i], 0.12);
        ctx.beginPath();
        ctx.moveTo(track[0], track[1]);
        for (let k = 2; k < track.length; k += 2) ctx.lineTo(track[k], track[k + 1]);
        ctx.stroke();
      }
      ctx.restore();

      // Over the tracks: a track is the centre of a pedestrian, and the body it
      // belongs to walks right up against the wall it is passing.
      fillWalls(ctx, walls);
      drawCrowd(ctx, agents, hair);
    },
  };
}

/* ------------------------------------------------------------------ plumbing */

export const SCENES: Array<() => Scene> = [bottleneck, counterflow, sightlines, trails];

/**
 * Paints one scene at one size.
 *
 * The portrait canvas is the landscape picture turned a quarter turn: the world
 * is rotated rather than rebuilt, so the phone and the desktop wallpaper are the
 * same crowd at the same moment, seen from a different edge. `hair` is one
 * screen pixel expressed in world units, which is what every stroke width in a
 * scene is quoted in.
 */
function render(ctx: CanvasRenderingContext2D, scene: Scene, size: Size): void {
  const portrait = size.h > size.w;
  const view = portrait ? scene.phone : scene.desktop;
  const scale = (portrait ? size.h : size.w) / view.across;

  ctx.fillStyle = toCss(BACKGROUND);
  ctx.fillRect(0, 0, size.w, size.h);

  ctx.save();
  ctx.translate(size.w / 2, size.h / 2);
  // Anticlockwise, so world +x runs up the phone: a crowd that walks left to
  // right across a desktop walks bottom to top up a phone, which is the reading
  // direction a tall picture has.
  if (portrait) ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-view.centre[0], -view.centre[1]);
  scene.paint(ctx, 1 / scale);
  ctx.restore();
}

const ENDPOINT = '/__walky/wallpaper';

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), type, quality);
  });
}

async function save(name: string, blob: Blob): Promise<string> {
  const response = await fetch(`${ENDPOINT}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  });
  if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
  return response.text();
}

/**
 * The preview the site shows in its wallpapers section, at roughly twice the
 * width it is shown at so it holds up on a 2x display. Lossy WebP: it is a
 * thumbnail of the picture, not the picture -- what gets downloaded is the PNG.
 *
 * The portrait one is half the width because it is shown at about half the
 * width; a 960px-wide phone preview is 2081px tall and weighs more than the
 * landscape one it sits next to.
 */
const PREVIEW_W = { landscape: 960, portrait: 480 };

const gallery = document.querySelector<HTMLDivElement>('#gallery')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;

interface Rendered {
  name: string;
  canvas: HTMLCanvasElement;
  previewWidth: number;
}

const rendered: Rendered[] = [];

function shrink(canvas: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = Math.round((canvas.height / canvas.width) * width);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function main(): void {
  for (const build of SCENES) {
    const scene = build();
    const row = document.createElement('figure');
    row.innerHTML = `<figcaption>${scene.slug} &mdash; ${scene.title}</figcaption>`;
    for (const size of SIZES) {
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      canvas.className = size.id;
      render(canvas.getContext('2d')!, scene, size);
      row.append(canvas);
      rendered.push({
        name: `walky-${scene.slug}-${size.id}`,
        canvas,
        previewWidth: size.w > size.h ? PREVIEW_W.landscape : PREVIEW_W.portrait,
      });
    }
    gallery.append(row);
  }
  status.textContent = `${rendered.length} images drawn`;
  saveButton.disabled = false;
}

saveButton.addEventListener('click', () => {
  void (async () => {
    saveButton.disabled = true;
    const written: string[] = [];
    try {
      for (const { name, canvas, previewWidth } of rendered) {
        written.push(await save(`${name}.png`, await toBlob(canvas, 'image/png')));
        const preview = shrink(canvas, previewWidth);
        written.push(await save(`${name}-preview.webp`, await toBlob(preview, 'image/webp', 0.82)));
        status.textContent = `${written.length} written`;
      }
      status.textContent = written.join('\n');
    } catch (error: unknown) {
      status.textContent = `${error}`;
    }
    saveButton.disabled = false;
  })();
});

main();
