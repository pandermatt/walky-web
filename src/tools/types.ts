import type { Point } from '../sim/geometry';

export type ToolId =
  | 'wall' | 'rectangle' | 'border' | 'pedestrian'
  | 'goal' | 'select' | 'shift' | 'tree';

/** What a tool is allowed to do to the world, kept narrow on purpose. */
export interface ToolContext {
  addWall(polygon: Point[]): boolean;
  /** Legal positions in the brush block centred on `at`, for placement and preview. */
  pedestrianBlock(at: Point): Point[];
  addTree(at: Point): void;
  addPedestrians(at: Point): void;
  setGoalAt(at: Point): void;
  selectAt(at: Point, extend: boolean): void;
  selectWithin(polygon: Point[], extend: boolean): void;
  panBy(dxScreen: number, dyScreen: number): void;
  requestRender(): void;
}

/** Transient state a tool wants drawn on the overlay. */
export interface ToolPreview {
  pendingWallPoints: Point[];
  pendingRect: [Point, Point] | null;
  selectionPolygon: Point[] | null;
  /** Where pedestrians would land if the brush fired now. */
  pendingPedestrians: Point[];
}

export const EMPTY_PREVIEW: ToolPreview = {
  pendingWallPoints: [],
  pendingRect: null,
  selectionPolygon: null,
  pendingPedestrians: [],
};

export interface PointerInfo {
  world: Point;
  screen: Point;
  /** Screen-space movement since the last event, for drag handlers. */
  dxScreen: number;
  dyScreen: number;
  shiftKey: boolean;
  buttons: number;
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor value, using the original 32x32 cursor PNGs. */
  readonly cursor: string;
  onPointerDown?(e: PointerInfo, ctx: ToolContext): void;
  onPointerMove?(e: PointerInfo, ctx: ToolContext): void;
  onPointerUp?(e: PointerInfo, ctx: ToolContext): void;
  onDoubleClick?(e: PointerInfo, ctx: ToolContext): void;
  /** Abandon anything in progress, e.g. on Escape or a tool switch. */
  cancel?(): void;
  preview(): ToolPreview;
}

export function cursorUrl(name: string, hotX = 0, hotY = 0): string {
  return `url(./cursors/${name}.png) ${hotX} ${hotY}, crosshair`;
}
