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
/** The eraser's, in the same pair: this badge takes away rather than adds. */
const GHOST_RED = '#D43A2D';
const GHOST_RED_EDGE = '#8E241B';

/** How far in from the top-left the readout starts, as drawInformationString had it. */
const DEBUG_MARGIN = 20;
/** Baseline to baseline, also from the original. */
const DEBUG_LINE_H = 20;
/**
 * The gap between the toolbar and a readout that has stepped around it -- the
 * same 12px the strip itself is inset by, so the text lines up with the rhythm
 * of the chrome rather than being pushed clear by an arbitrary amount.
 */
const DEBUG_CLEARANCE = 12;

/** A box of screen, in CSS pixels. `DOMRect` satisfies it, which is the point. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the debug readout starts, given the box the toolbar occupies.
 *
 * The readout belongs in the top-left corner -- that is where it has always
 * been, and it is the corner of the map with the least in it. In a browser the
 * toolbar is there too, a column of capsules 12px in from both edges over the
 * top of the canvas, and it was covering the first few characters of every
 * line: "Pedestrians Alive: 6" read as "strians Alive: 6". Installed on a phone
 * the strip is a bar across the bottom instead and the corner is free.
 *
 * So rather than choosing a corner per platform, or repeating the media query
 * that moves the bar, the text steps around wherever the bar actually is: an
 * intersection test against its measured box, indenting past its right edge
 * only when it genuinely overlaps. The width is measured rather than guessed
 * because it is what decides whether a bar off to one side is in the way at all.
 */
export function debugTextOrigin(
  lineCount: number,
  textWidth: number,
  bar: ScreenRect | null,
): Point {
  const origin: Point = [DEBUG_MARGIN, DEBUG_MARGIN];
  if (!bar || lineCount === 0) return origin;

  // The block of text: the top of the first line up to the baseline of the last.
  // Close enough for an overlap test -- a descender either side of it changes
  // nothing about whether a 600px column of buttons is in the way.
  const top = DEBUG_MARGIN - DEBUG_LINE_H;
  const bottom = DEBUG_MARGIN + (lineCount - 1) * DEBUG_LINE_H;
  const overlaps = bar.left < DEBUG_MARGIN + textWidth && bar.right > DEBUG_MARGIN
    && bar.top < bottom && bar.bottom > top;

  if (overlaps) origin[0] = bar.right + DEBUG_CLEARANCE;
  return origin;
}

/** An outline to draw, already expanded by the pedestrian radius. */
export interface HullOutline {
  points: Point[];
  color: RGB;
  /** Convex parts are drawn faintly; a group's hull is drawn solid. */
  faint: boolean;
}

export interface OverlayState {
  /**
   * The outlines to draw. Each set -- group hulls, convex parts -- has a toggle
   * of its own, and what is switched off simply is not in here.
   */
  hulls: HullOutline[];
  showDebug: boolean;
  /**
   * Where the toolbar is, so the readout can keep out of its way. Null when
   * there is no readout to place, which is most of the time.
   */
  toolbarBox: ScreenRect | null;
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
  /**
   * The line to show in the top-right corner, or null for the usual nothing.
   * Handed over as text rather than as a number and a reason, the same as
   * debugLines: what this layer knows is where a string goes.
   */
  speedReadout: string | null;
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

    this.drawConvexHulls(state.hulls);
    this.drawPendingWall(state.pendingWallPoints, state.mouseWorld, state.pendingWallTracing);
    this.drawPendingRect(state.pendingRect);
    this.drawPendingPolygons(state.pendingPolygons, state.pendingPolygonsInvalid);
    this.drawSelection(state.selectionPolygon);
    this.drawPendingPedestrians(state.pendingPedestrians, state.pedestrianRadius);
    this.drawTargetLines(state);
    this.drawCursorGhost(state.cursorGhost);
    if (state.speedReadout) this.drawSpeed(state.speedReadout);
    if (state.showDebug) this.drawDebug(state.debugLines, state.toolbarBox);
  }

  /**
   * Ports drawConvexHulls(): dashed, in each wall's own colour, the faint ones
   * being the convex parts and the solid ones the hulls.
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
      case 'eraser': {
        // The same badge as the drawing tools carry, leaning like the icon and
        // red rather than blue -- the one tool on the strip that removes.
        const size = 14;
        const gap = 3;
        const x = at[0] + gap;
        const y = at[1] + gap;
        const block = new Path2D();
        block.moveTo(x + size * 0.34, y + size);
        block.lineTo(x, y + size * 0.66);
        block.lineTo(x + size * 0.66, y);
        block.lineTo(x + size, y + size * 0.34);
        block.closePath();
        ctx.fillStyle = GHOST_RED;
        ctx.strokeStyle = GHOST_RED_EDGE;
        ctx.lineWidth = 1.5;
        ctx.fill(block);
        ctx.stroke(block);
        break;
      }
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

  /**
   * A single line in the top-right corner, which is what a recording is given to
   * say how fast the crowd it is showing was walking.
   *
   * That corner because it is the one the chrome never wants: the toolbar is a
   * column in the top-left in a browser and a bar across the bottom when
   * installed, and the recording clock is top centre. Bigger than the debug
   * readout because this one is written to be read back from a video file, which
   * has been scaled down at least once by the time anybody watches it, and a
   * shadow underneath because unlike the debug block it has no reserved corner
   * and may well be sitting over a pale wall.
   */
  private drawSpeed(text: string): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, this.canvas.width / dpr - DEBUG_MARGIN, DEBUG_MARGIN);
    ctx.restore();
  }

  /**
   * Ports drawInformationString(): white text pinned to the top-left, stepped
   * around the toolbar where the two share that corner (see debugTextOrigin).
   *
   * The font is set before the text is measured because measureText answers for
   * whatever font the context is carrying, which on a fresh frame is the
   * default sans one and not the monospace this draws in.
   */
  private drawDebug(lines: string[], toolbarBox: ScreenRect | null): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'alphabetic';
    const width = lines.reduce((w, line) => Math.max(w, ctx.measureText(line).width), 0);
    const [x, y] = debugTextOrigin(lines.length, width, toolbarBox);
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * DEBUG_LINE_H));
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
