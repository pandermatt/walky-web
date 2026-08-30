import { randomBrightColor, WHITE, type RGB } from '../palette';
import { monotoneChainHull } from '../sim/convexHull';
import { pointInPolygon, segmentsCross, type Point } from '../sim/geometry';

export interface Wall {
  id: number;
  /**
   * The shapes making up this wall. Usually one; the border tool builds a frame
   * from four overlapping bars as a single wall, so the frame is one object to
   * select, colour and delete.
   */
  polygons: Point[][];
  /**
   * Convex hull over every point of every polygon -- drawn dashed, and the broad
   * phase for navigation. Every wall has one; it is recomputed whenever the
   * polygons change.
   */
  hull: Point[];
  color: RGB;
  isGoal: boolean;
  /**
   * Set on the frame the border tool commits, and on nothing else.
   *
   * An enclosure is the one shape whose convex hull says something false: the
   * hull of a frame is the solid rectangle it encloses, so the outline would
   * claim the room's walkable interior as part of the obstacle, and every shape
   * inside or against the frame would be swallowed into that one group and lose
   * its own outline. So a border is left out of the hull grouping entirely --
   * see groupWalls. It is a wall like any other everywhere else: it blocks,
   * navigates, colours, selects and deletes the same.
   */
  isBorder: boolean;
  selected: boolean;
}

export interface Settings {
  showVisibleLines: boolean;
  showLineToTarget: boolean;
  /** The dashed outline around each connected group of shapes. */
  showConvexHull: boolean;
  /**
   * The convex *decomposition* -- a faint outline around every convex piece each
   * wall is navigated by, expanded like the hull is.
   *
   * A diagnostic for how a shape was split, not a view of the hull, and dense
   * enough to bury one: a traced shape carries an outline along its own edge and
   * a diagonal across every notch. Off by default, so the hull toggle shows the
   * hull.
   */
  showConvexParts: boolean;
  showPersonalSpace: boolean;
  showDebug: boolean;
  pedestrianRadius: number;
  /**
   * The room a pedestrian keeps around itself when it has the room to keep, in
   * pixels. Not a distance anyone holds to: a crowd gives some of it up as it
   * packs, and nearly all of it under pressure from behind.
   */
  personalSpace: number;
  speed: number;
  brushSize: number;
  /**
   * How fast the *next* generator lets people out, in pedestrians per second.
   *
   * The size of the next block, not a rate every generator runs at: each one
   * keeps what it was placed at, the way a label keeps the size it was written
   * at. Selecting a generator loads its rate back in here, so the one slider is
   * both "what the next one will be" and "what this one is".
   */
  generatorRate: number;
  /**
   * How tall a label is written, in world units.
   *
   * The size the *next* label takes, not a size every label has: each one keeps
   * what it was written at, the way the brush size is the size of the next block
   * rather than of every pedestrian on the map.
   */
  labelSize: number;
  /**
   * How heavy a label is written, on the font's own weight axis.
   *
   * Google Sans Flex is variable from 100 to 1000 (see ui/theme.ts), and a word
   * on a map competes with walls and a moving crowd for the eye, so it starts at
   * the top of that axis. The slider is there for the cases where it should not:
   * a note beside a title, or a caption that should not shout.
   */
  labelWeight: number;
  borderThickness: number;
  /** Whether a pedestrian plops when it reaches its goal. */
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showVisibleLines: false,
  showLineToTarget: true,
  showConvexHull: true,
  showConvexParts: false,
  showPersonalSpace: false,
  showDebug: false,
  pedestrianRadius: 13, // AbstractPedestrian's default.
  // The original's was 30. The brush no longer spaces a block by this, so a crowd
  // is painted shoulder to shoulder and opens out to whatever it is set to -- and
  // a little more room reads better as the thing it opens out *to*.
  personalSpace: 40,
  // The original walked one lattice step per frame, which is a crawl on a modern
  // display. Speed is now how many steps a pedestrian may buy per frame.
  speed: 4,
  brushSize: 1,
  // A steady trickle: fast enough to read as a flow within a second or two, slow
  // enough that a door is not instantly its own traffic jam.
  generatorRate: 4,
  // A little over two pedestrian diameters: the size at which a word reads as a
  // caption on the map rather than as something standing on it.
  labelSize: 28,
  labelWeight: 1000,
  // Mostly cosmetic: what a pedestrian actually cannot cross is the bar expanded
  // by its radius, so thickness changes how the wall looks far more than how it
  // blocks. The original used 2, which is a hairline on a modern display.
  borderThickness: 12,
  sound: true,
};

/**
 * The legal range of every numeric setting, in one place.
 *
 * The sliders are built from this, and so is the clamp that a loaded map goes
 * through -- a value out of a link is untrusted, and `state/` cannot reach into
 * `ui/` to find out what a slider would have allowed. It used to be written down
 * twice, as SPEED_MIN/SPEED_MAX here (which nothing read) and as the slider
 * specs there.
 */
export type NumericSetting =
  | 'pedestrianRadius' | 'personalSpace' | 'speed' | 'brushSize' | 'borderThickness'
  | 'labelSize' | 'labelWeight' | 'generatorRate';

export const SETTING_RANGES: Record<NumericSetting, { min: number; max: number; step: number }> = {
  speed: { min: 1, max: 20, step: 1 },
  pedestrianRadius: { min: 3, max: 40, step: 1 },
  personalSpace: { min: 0, max: 120, step: 1 },
  brushSize: { min: 1, max: 14, step: 1 },
  // From somebody through the door every second to a stream the door itself is
  // the bottleneck on -- past about twenty a generator spends most beats waiting
  // for its own footprint to clear.
  generatorRate: { min: 1, max: 20, step: 1 },
  borderThickness: { min: 2, max: 60, step: 1 },
  // From a word that has to be zoomed in on to one that titles the whole map.
  labelSize: { min: 8, max: 120, step: 1 },
  // The face's own axis, in steps coarse enough that every stop is a different
  // weight rather than a different number.
  labelWeight: { min: 100, max: 1000, step: 50 },
};

/**
 * The four bars of a border frame, overlapping at the corners.
 *
 * Ports BorderToolMouseListener.addBorderFrom. Extending every bar past the
 * corner by the thickness is what seals the frame: bars that merely met at a
 * shared corner point could leave a diagonal gap for a pedestrian to slip
 * through, which is exactly the failure an enclosure must not have.
 */
export function borderFrame(a: Point, b: Point, thickness: number): Point[][] {
  const t = Math.max(1, thickness);
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const bottom = Math.max(a[1], b[1]);
  return [
    rectanglePolygon([left - t, top - t], [right + t, top + t]),
    rectanglePolygon([left - t, bottom - t], [right + t, bottom + t]),
    rectanglePolygon([left - t, top - t], [left + t, bottom + t]),
    rectanglePolygon([right - t, top - t], [right + t, bottom + t]),
  ];
}

/**
 * Whether a frame would leave usable space inside.
 *
 * Navigation pushes each bar out by the pedestrian radius, so the interior a
 * pedestrian's centre can occupy shrinks by thickness + radius on every side.
 * Below that the box is sealed solid, and drawing one would look like it worked
 * while being unusable.
 */
export function borderFits(a: Point, b: Point, thickness: number, radius: number): boolean {
  const margin = 2 * (Math.max(1, thickness) + radius);
  return Math.abs(b[0] - a[0]) > margin + 2 * radius
    && Math.abs(b[1] - a[1]) > margin + 2 * radius;
}

let nextId = 1;

export function allPoints(wall: Wall): Point[] {
  return wall.polygons.flat();
}

export interface WallOptions {
  color?: RGB;
  /** True only for a border frame; see Wall.isBorder. */
  isBorder?: boolean;
}

export function makeWall(polygons: Point[][], options: WallOptions = {}): Wall {
  const { color = randomBrightColor(), isBorder = false } = options;
  return {
    id: nextId++,
    polygons,
    hull: monotoneChainHull(polygons.flat()),
    color,
    isGoal: false,
    isBorder,
    selected: false,
  };
}

/**
 * A word written on the map.
 *
 * Anchored to a world point rather than to the screen, and drawn at a size in
 * world units, so it belongs to the place it names: zooming in makes it bigger,
 * the way a word painted on the floor would be. That is the whole of it -- no
 * colour and no size of its own. A label is a caption on somebody's map, not a
 * drawing, and every one of them looking the same is what keeps it that way.
 */
export interface Label {
  id: number;
  at: Point;
  text: string;
  /**
   * Height in world units and weight on the font's axis, both taken from the
   * settings at the moment the label was written.
   *
   * Kept per label rather than read at draw time, so a title and a note beside
   * it can differ -- and so that moving a slider to write the next one does not
   * silently restyle every label already on the map.
   */
  size: number;
  weight: number;
}

/** How a label is written: what the two sliders said when it was. */
export interface LabelStyle {
  size: number;
  weight: number;
}

/** The longest a label may be, on the way in from a link as well as from a key. */
export const LABEL_MAX_CHARS = 120;

/** A number held to a setting's own range, as a slider would have held it. */
function inRange(value: number, key: 'labelSize' | 'labelWeight'): number {
  const { min, max } = SETTING_RANGES[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function makeLabel(at: Point, text: string, style: LabelStyle): Label {
  return {
    id: nextId++,
    at,
    text: text.slice(0, LABEL_MAX_CHARS),
    size: inRange(style.size, 'labelSize'),
    weight: inRange(style.weight, 'labelWeight'),
  };
}

/**
 * A block that lets pedestrians out, one after another, while the run is on.
 *
 * The brush paints a crowd; this paints a flow. A door that keeps letting people
 * through and a platform that keeps filling are the two things the map could not
 * say before, and faking either meant painting a long queue and watching it drain
 * exactly once.
 *
 * Everyone it emits walks to its goal, so pinning the generator pins everybody it
 * will ever produce -- and they are removed the moment they get there. They are
 * the flow rather than the crowd: there is nothing to reset them to, and a
 * generator that left its output standing at the goal would bury the map in a
 * minute.
 */
export interface Generator {
  id: number;
  /** Centre of the block; its extent is derived, see generatorSquare. */
  at: Point;
  /**
   * Pedestrians per second, as the slider was set when this one was placed.
   *
   * Kept per generator rather than read from the settings at emission time, for
   * the reason a label keeps its own size: a busy door and a quiet one on the
   * same map is the whole point, and one number in the settings could only
   * describe a map where every door is the same door.
   */
  rate: number;
  /** Goal wall id, or -1 while it is not pinned to anywhere. */
  goal: number;
  /** Its goal's colour, as a pedestrian wears its goal's -- or white unpinned. */
  color: RGB;
  /** Unlike Wall.selected, this one is read: it is what the goal tool aims at. */
  selected: boolean;
  /**
   * The queue behind the door: people who have arrived and not yet got through.
   *
   * A clump lands in here whole and leaves at whatever rate the doorway can pass
   * -- which is what makes a burst look like a burst rather than like ten people
   * appearing at once in a space that holds three.
   */
  owed: number;
  /** Which clump is next, indexing the door's own schedule; see sim/arrivals. */
  beat: number;
  /** Ticks left before that clump arrives. */
  wait: number;
}

/**
 * How many pedestrians across a generator's footprint is.
 *
 * Three, at the brush's own pitch, which is the smallest block that still gives
 * somebody a way out when the middle of it is occupied -- and the largest that
 * still reads as a door rather than as a room.
 */
export const GENERATOR_CELLS = 3;

/**
 * The square a generator occupies, in world units.
 *
 * Derived from the pedestrian radius rather than stored, so it is the size of the
 * people coming out of it at whatever the radius slider says -- the same bargain
 * the brush block makes. Drawing, hit-testing and the placement preview all call
 * this, so all three agree by construction.
 */
export function generatorSquare(at: Point, radius: number): Point[] {
  const half = GENERATOR_CELLS * radius;
  return rectanglePolygon([at[0] - half, at[1] - half], [at[0] + half, at[1] + half]);
}

export function generatorContains(g: Generator, p: Point, radius: number): boolean {
  return pointInPolygon(generatorSquare(g.at, radius), p);
}

export function makeGenerator(at: Point, rate: number): Generator {
  return {
    id: nextId++,
    at,
    rate: Math.max(1, Math.round(rate)),
    goal: -1,
    // White until it is pinned somewhere: a generator with no goal emits nothing,
    // and looking like every other unpinned thing on the map is how it says so.
    color: WHITE,
    selected: false,
    // All three are the run's rather than the map's: nothing here is serialized,
    // and Reset puts them back to nought, which is what makes it replay the same
    // demand through the same door. Nought rather than a first interval, so a
    // door opens the run with a clump instead of with a wait.
    owed: 0,
    beat: 0,
    wait: 0,
  };
}

export function wallContains(wall: Wall, p: Point): boolean {
  return wall.polygons.some((poly) => pointInPolygon(poly, p));
}

/** Ports Wall.intersectsWall: shared area or crossing edges. */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  if (a.some((p) => pointInPolygon(b, p))) return true;
  if (b.some((p) => pointInPolygon(a, p))) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

export function wallOverlapsPolygon(wall: Wall, poly: Point[]): boolean {
  return wall.polygons.some((p) => polygonsOverlap(p, poly));
}

/** Whether two walls share any area or crossing edge. */
export function wallsOverlap(a: Wall, b: Wall): boolean {
  return a.polygons.some((p) => wallOverlapsPolygon(b, p));
}

export function rectanglePolygon(a: Point, b: Point): Point[] {
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0], b[0]);
  const y2 = Math.max(a[1], b[1]);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}
