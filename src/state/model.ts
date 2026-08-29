import { randomBrightColor, type RGB } from '../palette';
import { monotoneChainHull } from '../sim/convexHull';
import { pointInPolygon, segmentsCross, type Point } from '../sim/geometry';

export interface Wall {
  id: number;
  /**
   * The shapes making up this wall. A wall starts as one polygon and gains more
   * when another shape is drawn overlapping it -- the original merged intersecting
   * walls into a single Wall rather than leaving them as separate obstacles
   * (Map.addWall / Wall.merge).
   */
  polygons: Point[][];
  /**
   * Convex hull over every point of every polygon -- drawn dashed, and the source
   * of the navigation graph's nodes. Recomputed whenever the polygons change, so
   * merging two overlapping shapes yields one hull wrapping both.
   */
  hull: Point[];
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
};

export const SPEED_MIN = 1;
export const SPEED_MAX = 20;

let nextId = 1;

export function allPoints(wall: Wall): Point[] {
  return wall.polygons.flat();
}

export function makeWall(polygons: Point[][], color: RGB = randomBrightColor()): Wall {
  return {
    id: nextId++,
    polygons,
    hull: monotoneChainHull(polygons.flat()),
    color,
    isGoal: false,
    selected: false,
  };
}

/** Recompute the hull after the polygon set changes. */
export function refreshHull(wall: Wall): void {
  wall.hull = monotoneChainHull(wall.polygons.flat());
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
