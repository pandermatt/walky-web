import { toCss, RED, WHITE, YELLOW, type RGB } from '../palette';
import type { Point } from '../sim/geometry';
import type { Viewport } from './viewport';
import type { CursorGhost, TargetLines } from '../tools/types';

/**
 * The 2D layer that sits on top of deck.gl: dashed outlines, in-progress tool
 * previews, and debug text. These are a handful of primitives with dash patterns
 * and text, which Canvas2D does far better than a GL layer.
 *
 * Stroke patterns come from PedestrianPanel:
 *   dashed    = BasicStroke(1, ..., new float[]{9}, 0)
 *   fatdashed = BasicStroke(6, ..., {21, 9, 3, 9}, 0)
 */
export const DASH = [9, 9];
export const FAT_DASH = [21, 9, 3, 9];

/** Badge colours for the rectangle tool's cursor ghost. */
const GHOST_BLUE = '#2D6FD4';
const GHOST_BLUE_EDGE = '#1B4E9E';

/** A hull outline to draw, already expanded by the pedestrian radius. */
export interface HullOutline {
  points: Point[];
  color: RGB;
  /** Convex parts are drawn faintly; the whole-wall hull is drawn solid. */
  faint: boolean;
}

export interface OverlayState {
  hulls: HullOutline[];
  showConvexHull: boolean;
  showDebug: boolean;
  /** Points of a wall being drawn right now. */
  pendingWallPoints: Point[];
  pendingWallTracing: boolean;
  /** Rectangle preview, as two world-space corners. */
  pendingRect: [Point, Point] | null;
  /** Arbitrary outlines to preview, e.g. the bars of a border frame. */
  pendingPolygons: Point[][];
  pendingPolygonsInvalid: boolean;
  /** Free-form selection outline. */
  selectionPolygon: Point[] | null;
  /** Ghost dots showing where the pedestrian brush would place. */
  pendingPedestrians: Point[];
  pedestrianRadius: number;
  /** Shape drawn under the pointer in place of a custom cursor image. */
  cursorGhost: CursorGhost | null;
  /** Lines from each pedestrian to the pointer, for the mark-goal tool. */
  targetLines: TargetLines | null;
  agentPositions: Point[];
  agentColors: RGB[];
  mouseWorld: Point | null;
  debugLines: string[];
}

export class Overlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private viewport: Viewport) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for the overlay canvas');
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  render(state: OverlayState): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (state.showConvexHull) this.drawConvexHulls(state.hulls);
    this.drawPendingWall(state.pendingWallPoints, state.mouseWorld, state.pendingWallTracing);
    this.drawPendingRect(state.pendingRect);
    this.drawPendingPolygons(state.pendingPolygons, state.pendingPolygonsInvalid);
    this.drawSelection(state.selectionPolygon);
    this.drawPendingPedestrians(state.pendingPedestrians, state.pedestrianRadius);
    this.drawTargetLines(state);
    this.drawCursorGhost(state.cursorGhost);
    if (state.showDebug) this.drawDebug(state.debugLines);
  }

  /**
   * Ports drawConvexHulls(): dashed, in each wall's own colour.
   *
   * The outline drawn is the hull *expanded by the pedestrian radius* -- the same
   * geometry the navigation graph and the legality checks use. Drawing the raw
   * hull instead would show a boundary that pedestrians appear to cross, because
   * what actually cannot enter the wall is a circle, not a point. Expanded, the
   * dashed line is exactly where a pedestrian's centre is allowed to go.
   */
  private drawConvexHulls(hulls: HullOutline[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.lineWidth = 1;
    for (const hull of hulls) {
      if (hull.points.length < 2) continue;
      ctx.globalAlpha = hull.faint ? 0.35 : 1;
      ctx.strokeStyle = toCss(hull.color);
      this.tracePath(hull.points, true);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Ports drawTemporaryBorder()/drawTemporaryEdges(): white, dashed, dots on points. */
  private drawPendingWall(points: Point[], mouse: Point | null, tracing: boolean): void {
    if (points.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = toCss(WHITE);
    ctx.fillStyle = toCss(WHITE);
    ctx.lineWidth = 1;
    ctx.setLineDash(DASH);

    if (tracing) {
      // A traced stroke is shown closed, since releasing closes it. No vertex
      // dots: the trace has one point every few pixels and they would read as a
      // solid smear rather than as vertices.
      this.tracePath(points, true);
      ctx.stroke();
      ctx.restore();
      return;
    }

    this.tracePath(points, false);
    // Rubber-band segment from the last placed point to the cursor.
    if (mouse) {
      const last = this.viewport.worldToScreen(points[points.length - 1]);
      const m = this.viewport.worldToScreen(mouse);
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(m[0], m[1]);
    }
    ctx.stroke();

    ctx.setLineDash([]);
    for (const p of points) {
      const s = this.viewport.worldToScreen(p);
      ctx.beginPath();
      ctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPendingRect(rect: [Point, Point] | null): void {
    if (!rect) return;
    const { ctx } = this;
    const a = this.viewport.worldToScreen(rect[0]);
    const b = this.viewport.worldToScreen(rect[1]);
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.strokeStyle = toCss(WHITE);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ctx.restore();
  }

  /**
   * Ports drawTemporaryPedestrians(): white dots where the brush would drop
   * pedestrians. Only legal spots are passed in, so a position already taken by
   * another pedestrian simply shows nothing.
   */
  private drawPendingPedestrians(points: Point[], radius: number): void {
    if (points.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.globalAlpha = 0.55;
    const r = Math.max(1, radius * this.viewport.scale);
    for (const p of points) {
      const s = this.viewport.worldToScreen(p);
      ctx.beginPath();
      ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Ports drawMarkTargetLine(): while the mark-goal tool is active, a line runs
   * from every pedestrian to the pointer. The original switched them to yellow
   * over a wall; here they take that wall's colour, which previews the colour the
   * crowd is about to become.
   */
  private drawTargetLines(state: OverlayState): void {
    const lines = state.targetLines;
    if (!lines) return;
    const { ctx } = this;
    const to = this.viewport.worldToScreen(lines.to);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    // A shared colour can be stroked in one path; otherwise each line is its own.
    if (lines.color) {
      ctx.strokeStyle = toCss(lines.color as RGB);
      ctx.beginPath();
      for (const p of state.agentPositions) {
        const s = this.viewport.worldToScreen(p);
        ctx.moveTo(s[0], s[1]);
        ctx.lineTo(to[0], to[1]);
      }
      ctx.stroke();
    } else {
      state.agentPositions.forEach((p, i) => {
        ctx.strokeStyle = toCss(state.agentColors[i] ?? YELLOW);
        const s = this.viewport.worldToScreen(p);
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  /**
   * The shape the active tool will produce, drawn under the pointer.
   *
   * This replaces the original's custom cursor PNGs: a 32x32 image cannot show
   * the real size of what is about to be placed, while this scales with zoom and
   * with the tool's own settings.
   */
  private drawCursorGhost(ghost: CursorGhost | null): void {
    if (!ghost || ghost.kind === 'none') return;
    const { ctx } = this;
    const at = this.viewport.worldToScreen(ghost.at);
    const r = Math.max(3, ghost.size * this.viewport.scale);
    ctx.save();
    ctx.strokeStyle = toCss(WHITE);
    ctx.fillStyle = toCss(WHITE);
    ctx.lineWidth = 1;

    switch (ghost.kind) {
      case 'square': {
        // A badge hanging off the pointer's lower-right, the way a tool cursor
        // carries its icon. Fixed pixel size rather than world units: it says
        // which tool is armed, so it should not grow or shrink with zoom, and it
        // sits clear of the pointer instead of under it.
        const size = 14;
        const gap = 3;
        const x = at[0] + gap;
        const y = at[1] + gap;
        ctx.fillStyle = GHOST_BLUE;
        ctx.strokeStyle = GHOST_BLUE_EDGE;
        ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, size, size);
        ctx.strokeRect(x, y, size, size);
        break;
      }
      case 'frame': {
        // A hollow square badge: the border tool makes an outline, not a fill.
        const size = 14;
        const gap = 3;
        const bx = at[0] + gap;
        const by = at[1] + gap;
        ctx.strokeStyle = GHOST_BLUE;
        ctx.lineWidth = 3;
        ctx.strokeRect(bx + 1.5, by + 1.5, size - 3, size - 3);
        break;
      }
      case 'squiggle': {
        // The freehand wall tool's badge, in the same spot and colour as the
        // rectangle tool's square: a hand-drawn wave for a hand-drawn polygon.
        const size = 14;
        const gap = 3;
        const x = at[0] + gap;
        const y = at[1] + gap;
        const wave = new Path2D();
        wave.moveTo(x, y + size * 0.72);
        wave.quadraticCurveTo(x + size * 0.22, y + size * 1.05, x + size * 0.5, y + size * 0.42);
        wave.quadraticCurveTo(x + size * 0.78, y - size * 0.22, x + size, y + size * 0.2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // A dark pass underneath keeps it legible over a bright wall.
        ctx.strokeStyle = GHOST_BLUE_EDGE;
        ctx.lineWidth = 4.5;
        ctx.stroke(wave);
        ctx.strokeStyle = GHOST_BLUE;
        ctx.lineWidth = 2.5;
        ctx.stroke(wave);
        break;
      }
      case 'tree':
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'target': {
        // A ring with a cross through it, echoing the goal icon.
        ctx.beginPath();
        ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(at[0] - r - 4, at[1]);
        ctx.lineTo(at[0] + r + 4, at[1]);
        ctx.moveTo(at[0], at[1] - r - 4);
        ctx.lineTo(at[0], at[1] + r + 4);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  /**
   * Outlines a tool is about to commit. Drawn red when the tool has flagged them
   * as unusable -- a border frame too small to hold anyone, say -- so it is clear
   * why releasing will do nothing.
   */
  private drawPendingPolygons(polygons: Point[][], invalid: boolean): void {
    if (polygons.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.strokeStyle = invalid ? toCss(RED) : toCss(WHITE);
    ctx.lineWidth = invalid ? 2 : 1;
    for (const poly of polygons) {
      if (poly.length < 2) continue;
      this.tracePath(poly, true);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSelection(poly: Point[] | null): void {
    if (!poly || poly.length < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.strokeStyle = toCss(YELLOW);
    ctx.lineWidth = 1;
    this.tracePath(poly, true);
    ctx.stroke();
    ctx.restore();
  }

  /** Ports drawInformationString(): white text pinned to the top-left. */
  private drawDebug(lines: string[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => ctx.fillText(line, 20, 20 + i * 20));
    ctx.restore();
  }

  private tracePath(points: Point[], close: boolean): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = this.viewport.worldToScreen(p);
      if (i === 0) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    });
    if (close) ctx.closePath();
  }
}
