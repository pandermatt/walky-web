import type { Point } from '../sim/geometry';
import type { Settings, WallOptions } from '../state/model';

export type ToolId =
  | 'wall' | 'rectangle' | 'border' | 'pedestrian'
  | 'goal' | 'select' | 'shift';

/** What a tool is allowed to do to the world, kept narrow on purpose. */
export interface ToolContext {
  addWall(polygon: Point[], options?: WallOptions): boolean;
  /** Adds one wall made of several polygons, as a border frame is. */
  addWallShape(polygons: Point[][], options?: WallOptions): boolean;
  /** Current settings, for tools that need sizes at preview time. */
  settings(): Readonly<Settings>;
  /** Legal positions in the brush block centred on `at`, for placement and preview. */
  pedestrianBlock(at: Point): Point[];
  addPedestrians(at: Point): void;
  setGoalAt(at: Point): void;
  /** Select the pedestrian under a point (or clear, if there is none). */
  selectPedestrianAt(at: Point, extend: boolean): void;
  /** Select every pedestrian inside a lasso outline. */
  selectPedestriansIn(lasso: Point[], extend: boolean): void;
  /** Drop the current selection. */
  clearSelection(): void;
  /** How many pedestrians are currently selected. */
  selectionCount(): number;
  /**
   * Put the toolbar back to no active tool. Used after a one-shot action has
   * completed, so the next click cannot repeat it by accident.
   */
  deactivateTool(): void;
  /**
   * Hand the next click to another tool. Used to carry a gesture on to the step
   * that always follows it -- a selection is made in order to be sent somewhere.
   */
  activateTool(id: ToolId): void;
  /** Say something to the user, as the chip that shared maps and updates use. */
  notify(message: string): void;
  panBy(dxScreen: number, dyScreen: number): void;
  requestRender(): void;
  /** Colour of the wall under a point, if any -- used to tint the goal preview. */
  colorAt(at: Point): [number, number, number] | null;
  /** Live positions of every pedestrian, for previews that reference them. */
  agentPositions(): Point[];
  /** World units per screen pixel, so tolerances can be expressed in pixels. */
  worldPerPixel(): number;
}

/**
 * The shape drawn under the pointer to say what the active tool will do.
 *
 * Replaces the original's custom cursor images. A 32x32 PNG cursor is small,
 * fixed-size, and cannot show the tool's actual dimensions -- it can't grow with
 * the pedestrian radius or the brush size, and it blurs at whatever scale the
 * browser decides. Drawing the shape on the canvas instead means the pointer
 * always previews the real thing at the real size, the way the pedestrian brush
 * already did.
 */
export type GhostKind = 'square' | 'squiggle' | 'frame' | 'target' | 'none';

export interface CursorGhost {
  kind: GhostKind;
  at: Point;
  /** Radius or half-extent, in world units. */
  size: number;
}

/** Lines from each pedestrian to the pointer, for the mark-goal tool. */
export interface TargetLines {
  to: Point;
  /** Colour of the shape under the pointer, or null to use each pedestrian's own. */
  color: [number, number, number] | null;
}

/** Transient state a tool wants drawn on the overlay. */
export interface ToolPreview {
  pendingWallPoints: Point[];
  /** True while tracing freehand: draw as a closing outline, not placed vertices. */
  pendingWallTracing: boolean;
  pendingRect: [Point, Point] | null;
  /** Arbitrary outlines to preview, e.g. the bars of a border frame. */
  pendingPolygons: Point[][];
  /** Draw the pending outlines as a warning: the shape would be unusable. */
  pendingPolygonsInvalid: boolean;
  selectionPolygon: Point[] | null;
  /** Where pedestrians would land if the brush fired now. */
  pendingPedestrians: Point[];
  cursorGhost: CursorGhost | null;
  targetLines: TargetLines | null;
}

export const EMPTY_PREVIEW: ToolPreview = {
  pendingWallPoints: [],
  pendingWallTracing: false,
  pendingRect: null,
  pendingPolygons: [],
  pendingPolygonsInvalid: false,
  selectionPolygon: null,
  pendingPedestrians: [],
  cursorGhost: null,
  targetLines: null,
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
  /** A standard CSS cursor keyword; the tool's shape is drawn on the canvas. */
  readonly cursor: string;
  onPointerDown?(e: PointerInfo, ctx: ToolContext): void;
  onPointerMove?(e: PointerInfo, ctx: ToolContext): void;
  onPointerUp?(e: PointerInfo, ctx: ToolContext): void;
  onDoubleClick?(e: PointerInfo, ctx: ToolContext): void;
  /** Abandon anything in progress, e.g. on Escape or a tool switch. */
  cancel?(): void;
  preview(): ToolPreview;
}


