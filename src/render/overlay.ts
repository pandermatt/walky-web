import { toCss, RED, WHITE, YELLOW, type RGB } from '../palette';
import type { Point } from '../sim/geometry';
import type { Viewport } from './viewport';
import type { CursorGhost, TargetLines } from '../tools/types';
import type { Label, LabelStyle } from '../state/model';

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

/**
 * The size below which a label is not drawn at all.
 *
 * Zoomed far enough out a caption is a two-pixel smudge -- unreadable, but still
 * dark enough to be mistaken for something on the map. Nothing is the honest
 * picture of a word too small to read.
 */
export const LABEL_MIN_PX = 5;

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

let cachedFamily = '';

/**
 * The app's own font stack, taken from the token the stylesheet sets.
 *
 * Canvas2D will not read a CSS variable, so the value is fetched once and kept:
 * it is a constant in practice, and getComputedStyle on every frame of a running
 * crowd is a layout read nobody asked for. The fallback is the token's own tail,
 * for the moment before the theme is installed.
 */
function labelFamily(): string {
  if (cachedFamily) return cachedFamily;
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--wk-font-family').trim();
  cachedFamily = token || 'system-ui, -apple-system, sans-serif';
  return cachedFamily;
}

/**
 * A canvas font string for a label.
 *
 * The weight goes in front of the size, which is the shorthand's own order and
 * the only place Canvas2D will take one. Google Sans Flex is variable from 100
 * to 1000, so every stop the slider offers is a real cut of the face rather than
 * a browser's synthetic bolding of one.
 */
function labelFont(px: number, weight: number): string {
  return `${weight} ${px}px ${labelFamily()}`;
}

/**
 * The box a label fills, in world units, given the width its text measures.
 *
 * Pure, and separate from the measuring, because the arithmetic is the part that
 * can be wrong: a label is drawn from its anchor rightwards and centred on it
 * vertically (textAlign start, textBaseline middle), so the box runs forward in
 * x and half its height either side in y. The measuring needs a canvas and a
 * loaded font; this needs neither.
 *
 * `pad` is world units of clearance, for an outline that should sit clear of the
 * glyphs rather than clipping them.
 */
export function labelBox(
  at: Point, width: number, size: number, pad = 0,
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: at[0] - pad,
    minY: at[1] - size / 2 - pad,
    maxX: at[0] + width + pad,
    maxY: at[1] + size / 2 + pad,
  };
}

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
  /** The words written on the map, and the one being typed if there is one. */
  labels: Label[];
  /**
   * The label the eraser is over, faded the way a wall under it is faded on the
   * layer below -- the outline says what would go, and the fade says it is this
   * one and not the word beside it.
   */
  fadedLabel: number | null;
  editingLabel: EditingLabel | null;
  /** How the one being typed is written: what the sliders are set to. */
  editingLabelStyle: LabelStyle;
  /** The recording's frame, while one is being dragged or held. */
  recordFrame: RecordFrame | null;
  /**
   * The box the readout sits inside, or null for the whole canvas. What keeps
   * the speed inside a cropped recording rather than off the side of it.
   */
  speedAnchor: ScreenRect | null;
}

/**
 * The rectangle a recording is framed to, in screen pixels.
 *
 * `dim` is the difference between choosing the frame and living with it. While
 * it is being dragged the rest of the screen is dimmed, because the question
 * being asked is what gets left out. Once the take is running the dimming would
 * be a lie -- what is outside is not darker, it is simply not in the file -- so
 * only the border is drawn, and drawn *outside* the frame, where the crop cannot
 * see it.
 */
export interface RecordFrame {
  rect: ScreenRect;
  dim: boolean;
}

/** A label mid-keystroke: where it will land, and how far it has got. */
export interface EditingLabel {
  at: Point;
  text: string;
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

    // First, under everything: a label is part of the map, not chrome over it,
    // so a rubber-band line or a lasso crosses it rather than passing beneath.
    this.drawLabels(state.labels, state.editingLabel, state.editingLabelStyle, state.fadedLabel);
    this.drawConvexHulls(state.hulls);
    this.drawPendingWall(state.pendingWallPoints, state.mouseWorld, state.pendingWallTracing);
    this.drawPendingRect(state.pendingRect);
    this.drawPendingPolygons(state.pendingPolygons, state.pendingPolygonsInvalid);
    this.drawSelection(state.selectionPolygon);
    this.drawPendingPedestrians(state.pendingPedestrians, state.pedestrianRadius);
    this.drawTargetLines(state);
    this.drawCursorGhost(state.cursorGhost);
    this.drawRecordFrame(state.recordFrame);
    if (state.speedReadout) this.drawSpeed(state.speedReadout, state.speedAnchor);
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
  /**
   * The words on the map, and the word being typed.
   *
   * Both by the same routine, deliberately: the preview is not a preview so much
   * as the label itself, drawn a keystroke at a time before it is committed. A
   * caret follows the one being typed, solid rather than blinking -- a blink
   * would need a repaint twice a second for the whole of an edit, and a bar that
   * is simply there says the same thing.
   *
   * Not suppressed while recording, unlike the pointer previews: this is content
   * somebody put on the map on purpose, and a caption the recording drops is a
   * caption nobody can see in the file it was written for.
   */
  private drawLabels(
    labels: Label[],
    editing: EditingLabel | null,
    editingStyle: LabelStyle,
    faded: number | null,
  ): void {
    if (labels.length === 0 && !editing) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.textBaseline = 'middle';
    // The same shadow the speed readout wears, and for the same reason: there is
    // no reserved corner for this, so it may well be sitting over a pale wall.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 4;

    // Each label at its own size, since each was written at whatever the slider
    // said. The font is set per label rather than once, which costs a string a
    // label and buys a map that can carry a title and a footnote.
    for (const label of labels) {
      const px = label.size * this.viewport.scale;
      // Zoomed far enough out a caption is an unreadable smudge that still reads
      // as something on the map. Nothing is the honest picture of it.
      if (px < LABEL_MIN_PX) continue;
      ctx.font = labelFont(px, label.weight);
      ctx.globalAlpha = label.id === faded ? 0.35 : 1;
      const at = this.viewport.worldToScreen(label.at);
      ctx.fillText(label.text, at[0], at[1]);
    }
    ctx.globalAlpha = 1;

    if (editing) {
      // The one being typed is drawn however small it is: it is not a word on
      // the map yet, it is where you are working.
      const px = Math.max(LABEL_MIN_PX, editingStyle.size * this.viewport.scale);
      ctx.font = labelFont(px, editingStyle.weight);
      const at = this.viewport.worldToScreen(editing.at);
      ctx.fillText(editing.text, at[0], at[1]);
      const caret = at[0] + ctx.measureText(editing.text).width + 1;
      const half = px * 0.55;
      ctx.fillRect(caret, at[1] - half, Math.max(1, px * 0.06), half * 2);
    }
    ctx.restore();
  }

  /**
   * Where a label sits in the world, for anything that has to point at one.
   *
   * The measurement is this class's to give: it is the only place that knows
   * which font the label is drawn in, and a box guessed from the character count
   * would be wrong by a word. Measured at the label's own size, which is in world
   * units, so the width comes back in world units too and does not move with the
   * camera.
   */
  labelBounds(label: Label, pad = 0): { minX: number; minY: number; maxX: number; maxY: number } {
    const { ctx } = this;
    ctx.save();
    ctx.font = labelFont(label.size, label.weight);
    const width = ctx.measureText(label.text).width;
    ctx.restore();
    return labelBox(label.at, width, label.size, pad);
  }

  private drawSpeed(text: string, anchor: ScreenRect | null): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    // The corner of the picture being recorded, which is the window's own only
    // while the whole window is what is being recorded.
    const right = anchor ? anchor.right : this.canvas.width / dpr;
    const top = anchor ? anchor.top : 0;
    ctx.save();
    ctx.fillStyle = toCss(WHITE);
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, right - DEBUG_MARGIN, top + DEBUG_MARGIN);
    ctx.restore();
  }

  /**
   * The recording's frame: what is about to be in the file, and what is not.
   *
   * The dim pass is one path with the whole canvas and the frame in it, filled
   * `evenodd` so the frame is the hole -- a single fill rather than four bars
   * around the edge, which is both less arithmetic and free of the seams four
   * rectangles leave where they meet.
   */
  private drawRecordFrame(frame: RecordFrame | null): void {
    if (!frame) return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const { rect } = frame;
    const w = rect.right - rect.left;
    const h = rect.bottom - rect.top;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    if (frame.dim) {
      const mask = new Path2D();
      mask.rect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
      mask.rect(rect.left, rect.top, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill(mask, 'evenodd');
      ctx.setLineDash(DASH);
      ctx.strokeStyle = toCss(WHITE);
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, w, h);
    } else {
      // Two pixels out, so the marker is beside the picture rather than in it.
      ctx.setLineDash(DASH);
      ctx.strokeStyle = toCss(WHITE);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left - 2.5, rect.top - 2.5, w + 5, h + 5);
    }
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
