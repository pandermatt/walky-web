import { randomBrightColor, type RGB } from '../palette';
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
  /**
   * Whether this wall's points may be merged into the outline drawn over a group
   * of touching shapes.
   *
   * The dashed outline is drawn per connected group, so shapes drawn against each
   * other read as one object. That works for shapes a hull describes -- a
   * rectangle, a frame, a blocky building -- but a freehand trace is the opposite,
   * an S, a spiral, a coastline, and letting one into a group stretches the
   * group's outline over everything the trace wanders past.
   *
   * False keeps the wall out of that shared outline. It still has a hull of its
   * own, and that hull is still drawn -- so the convex-hull view shows something
   * for every shape on the map -- it is simply drawn for that wall alone. See
   * groupWalls.
   */
  sharesOutline: boolean;
  color: RGB;
  isGoal: boolean;
  selected: boolean;
}

export interface Tree {
  id: number;
  position: Point;
  radius: number;
}

export interface Settings {
  showVisibleLines: boolean;
  showLineToTarget: boolean;
  showConvexHull: boolean;
  showPreferredRadius: boolean;
  showDebug: boolean;
  pedestrianRadius: number;
  preferredSpace: number;
  speed: number;
  brushSize: number;
  borderThickness: number;
  /** Whether a pedestrian plops when it reaches its goal. */
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showVisibleLines: false,
  showLineToTarget: true,
  showConvexHull: true,
  showPreferredRadius: false,
  showDebug: false,
  // Defaults from AbstractPedestrian: radius 13, preferredSpace 30.
  pedestrianRadius: 13,
  preferredSpace: 30,
  // The original walked one lattice step per frame, which is a crawl on a modern
  // display. Speed is now how many steps a pedestrian may buy per frame.
  speed: 4,
  brushSize: 1,
  // Mostly cosmetic: what a pedestrian actually cannot cross is the bar expanded
  // by its radius, so thickness changes how the wall looks far more than how it
  // blocks. The original used 2, which is a hairline on a modern display.
  borderThickness: 12,
  sound: true,
};

export const SPEED_MIN = 1;
export const SPEED_MAX = 20;

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
  /** False to keep this wall out of a group's shared outline; see Wall.sharesOutline. */
  sharesOutline?: boolean;
}

export function makeWall(polygons: Point[][], options: WallOptions = {}): Wall {
  const { color = randomBrightColor(), sharesOutline = true } = options;
  return {
    id: nextId++,
    polygons,
    hull: monotoneChainHull(polygons.flat()),
    sharesOutline,
    color,
    isGoal: false,
    selected: false,
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

export function makeTree(position: Point, radius = 22): Tree {
  return { id: nextId++, position, radius };
}

export function rectanglePolygon(a: Point, b: Point): Point[] {
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0], b[0]);
  const y2 = Math.max(a[1], b[1]);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}
