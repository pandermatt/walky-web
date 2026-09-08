/**
 * Cutting a 3x3 character sheet in `sheets/` into nine stickers.
 *
 * The sheets are contact sheets: nine drawings laid out three across, already
 * cut out against transparency. What is not laid out is a grid. A speech bubble
 * leans into the row above it, a wall runs off the right-hand side, a crowd
 * spreads wider than its share of the width -- so slicing the sheet into nine
 * equal 418px tiles takes a corner off a bubble here and leaves a neighbour's
 * elbow in the frame there, and which of the two you get is luck.
 *
 * So the sheet is read as art rather than as a grid. Every horizontal run of
 * opaque pixels is labelled, runs that touch are merged into shapes, each shape
 * is filed under whichever of the nine cells its centroid lands in, and a
 * sticker is the cluster that grows outwards from the largest shape in that
 * cell: it picks up the satellites that belong to it -- a heart, a sparkle, a
 * motion mark, a bubble that floats free of its tail -- and stops before it
 * reaches anything that belongs to the sticker next door.
 *
 * The frame is then that cluster's own bounding box, squared and given air.
 * Everything outside the cluster is erased *before* the crop, which is the step
 * that matters: the box is wider than the art it was measured from, so without
 * the erase a square frame drawn around a wide sticker collects a slice of its
 * neighbour along with it.
 *
 * ImageMagick is a codec here and nothing else: it hands over RGBA and takes
 * RGBA back. Even the scale to sticker size is done below rather than by
 * `-resize`, because the alpha-correct way to ask for it -- `-alpha Associate`,
 * resize, `-alpha Disassociate` -- bakes the channel flat on the way in and
 * leaves `Disassociate` nothing to recover from. Stickers come back fully
 * opaque: the white keyline on a black square, which is the one thing a sticker
 * may not be. Resampling over premultiplied alpha is a dozen lines, and they are
 * `resample` below.
 */
import { execFileSync } from 'node:child_process';

/** Below this a pixel is ground, not art. Low, so antialiased edges survive the mask. */
const ALPHA_FLOOR = 8;

/** Specks the sheet was exported with. None of them are drawings. */
const MIN_AREA = 300;

/** How far a satellite may sit from the body it belongs to. */
const GAP = 70;

/** Air between the art and the edge of the frame, as a fraction of the long side. */
const MARGIN = 0.035;

interface Shape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  cx: number;
  cy: number;
}

function decode(path: string): { w: number; h: number; rgba: Uint8Array } {
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', path])
    .toString().trim().split(/\s+/).map(Number);
  const out = execFileSync('magick', [path, '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 28 });
  return { w, h, rgba: new Uint8Array(out.buffer, out.byteOffset, out.length) };
}

/**
 * Connected shapes, by row runs and union-find.
 *
 * Run-based rather than per-pixel because a sheet is 1.5M pixels and all but a
 * few thousand of them are interior: a row of a speech bubble is one run, and
 * merging two rows is a walk down two short lists rather than a visit to every
 * pixel in both.
 */
function shapes(rgba: Uint8Array, w: number, h: number): { list: Shape[]; owner: Int32Array } {
  const runs: number[] = []; // y, x0, x1 (x1 exclusive), flat
  const rowAt = new Int32Array(h + 1);
  for (let y = 0; y < h; y++) {
    rowAt[y] = runs.length / 3;
    let x = 0;
    while (x < w) {
      while (x < w && rgba[(y * w + x) * 4 + 3] < ALPHA_FLOOR) x++;
      if (x >= w) break;
      const s = x;
      while (x < w && rgba[(y * w + x) * 4 + 3] >= ALPHA_FLOOR) x++;
      runs.push(y, s, x);
    }
  }
  rowAt[h] = runs.length / 3;

  const n = runs.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Eight-connected: runs that only touch at a diagonal are still one shape,
  // which is what keeps a one-pixel-wide antialiased join from splitting a
  // drawing in two.
  for (let y = 1; y < h; y++) {
    let i = rowAt[y - 1], j = rowAt[y];
    while (i < rowAt[y] && j < rowAt[y + 1]) {
      const a0 = runs[i * 3 + 1], a1 = runs[i * 3 + 2];
      const b0 = runs[j * 3 + 1], b1 = runs[j * 3 + 2];
      if (a0 <= b1 && b0 <= a1) join(i, j);
      if (a1 < b1) i++; else j++;
    }
  }

  const byRoot = new Map<number, Shape>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const y = runs[i * 3], x0 = runs[i * 3 + 1], x1 = runs[i * 3 + 2];
    const len = x1 - x0;
    const s = byRoot.get(r);
    if (!s) {
      byRoot.set(r, { x0, y0: y, x1, y1: y + 1, area: len, cx: (x0 + x1) / 2 * len, cy: y * len });
    } else {
      s.x0 = Math.min(s.x0, x0); s.x1 = Math.max(s.x1, x1);
      s.y0 = Math.min(s.y0, y); s.y1 = Math.max(s.y1, y + 1);
      s.area += len; s.cx += (x0 + x1) / 2 * len; s.cy += y * len;
    }
  }

  // `owner` maps every pixel to the shape it belongs to, so the mask below is a
  // lookup rather than a second pass over the geometry.
  const owner = new Int32Array(w * h).fill(-1);
  const list: Shape[] = [];
  const index = new Map<number, number>();
  for (const [root, s] of byRoot) {
    if (s.area < MIN_AREA) continue;
    s.cx /= s.area; s.cy /= s.area;
    index.set(root, list.length);
    list.push(s);
  }
  for (let i = 0; i < n; i++) {
    const k = index.get(find(i));
    if (k === undefined) continue;
    const y = runs[i * 3], x0 = runs[i * 3 + 1], x1 = runs[i * 3 + 2];
    owner.fill(k, y * w + x0, y * w + x1);
  }
  return { list, owner };
}

const near = (a: Shape, b: Shape): boolean =>
  a.x0 - GAP <= b.x1 && b.x0 - GAP <= a.x1 && a.y0 - GAP <= b.y1 && b.y0 - GAP <= a.y1;

/** Lanczos-3, the window ImageMagick would have used had it been able to keep the alpha. */
const A = 3;
const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number): number => (Math.abs(x) < A ? sinc(x) * sinc(x / A) : 0);

/**
 * One axis of the filter, as the source pixels each destination pixel draws on.
 *
 * Widened by the scale when shrinking: a destination pixel that stands for two
 * source pixels has to see both of them, or the result is point sampling with a
 * fancy name.
 */
function taps(from: number, to: number): { start: number; w: Float64Array }[] {
  const scale = to / from;
  const reach = scale < 1 ? A / scale : A;
  return [...Array(to).keys()].map((i) => {
    const centre = (i + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.ceil(centre - reach));
    const end = Math.min(from - 1, Math.floor(centre + reach));
    const w = new Float64Array(end - start + 1);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      const v = lanczos(scale < 1 ? (j - centre) * scale : j - centre);
      w[j - start] = v;
      sum += v;
    }
    for (let k = 0; k < w.length; k++) w[k] /= sum;
    return { start, w };
  });
}

/**
 * Square RGBA to square RGBA, resampled over premultiplied alpha.
 *
 * Premultiplied because the colour under a transparent pixel is arbitrary --
 * here it is black -- and averaging it in as though it were paint is what draws
 * a dark rim around every white keyline in the pack.
 */
function resample(src: Uint8Array, from: number, to: number): Uint8Array {
  const pm = new Float64Array(from * from * 4);
  for (let i = 0; i < from * from; i++) {
    const a = src[i * 4 + 3] / 255;
    pm[i * 4] = src[i * 4] * a;
    pm[i * 4 + 1] = src[i * 4 + 1] * a;
    pm[i * 4 + 2] = src[i * 4 + 2] * a;
    pm[i * 4 + 3] = src[i * 4 + 3];
  }

  const cols = taps(from, to);
  const mid = new Float64Array(to * from * 4);
  for (let y = 0; y < from; y++) {
    for (let x = 0; x < to; x++) {
      const { start, w } = cols[x];
      const to4 = (y * to + x) * 4;
      for (let k = 0; k < w.length; k++) {
        const from4 = (y * from + start + k) * 4;
        mid[to4] += pm[from4] * w[k];
        mid[to4 + 1] += pm[from4 + 1] * w[k];
        mid[to4 + 2] += pm[from4 + 2] * w[k];
        mid[to4 + 3] += pm[from4 + 3] * w[k];
      }
    }
  }

  const rows = taps(from, to);
  const out = new Uint8Array(to * to * 4);
  for (let y = 0; y < to; y++) {
    const { start, w } = rows[y];
    for (let x = 0; x < to; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const from4 = ((start + k) * to + x) * 4;
        r += mid[from4] * w[k];
        g += mid[from4 + 1] * w[k];
        b += mid[from4 + 2] * w[k];
        a += mid[from4 + 3] * w[k];
      }
      const to4 = (y * to + x) * 4;
      const clamped = Math.min(255, Math.max(0, a));
      // Back out of premultiplied. Where nothing landed the colour is unknowable
      // and also unseen, so it stays at zero.
      const s = clamped > 0.5 ? 255 / clamped : 0;
      out[to4] = Math.min(255, Math.max(0, Math.round(r * s)));
      out[to4 + 1] = Math.min(255, Math.max(0, Math.round(g * s)));
      out[to4 + 2] = Math.min(255, Math.max(0, Math.round(b * s)));
      out[to4 + 3] = Math.round(clamped);
    }
  }
  return out;
}

function encode(rgba: Uint8Array, size: number): Buffer {
  return execFileSync('magick', [
    '-depth', '8', '-size', `${size}x${size}`, 'rgba:-',
    // Without this every PNG carries the moment it was written, and the pack is
    // eighteen different files on every run -- a diff nobody can read, in a
    // directory whose whole claim is that regenerating it changes nothing unless
    // the art did.
    '-define', 'png:exclude-chunk=time,date', '-strip',
    'png32:-',
  ], { input: Buffer.from(rgba), maxBuffer: 1 << 28 });
}

/** The nine stickers of one sheet, row-major, each a square PNG `box` on a side. */
export function sliceSheet(path: string, box: number): Buffer[] {
  const { w, h, rgba } = decode(path);
  const { list, owner } = shapes(rgba, w, h);

  const cell = w / 3;
  const centre = [0, 1, 2].map((i) => cell * (i + 0.5));
  const nearest = (v: number): number =>
    centre.reduce((best, c, i) => (Math.abs(v - c) < Math.abs(v - centre[best]) ? i : best), 0);

  const cells = new Map<number, number[]>();
  list.forEach((s, i) => {
    const key = nearest(s.cy) * 3 + nearest(s.cx);
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
  });

  return [...Array(9).keys()].map((key) => {
    const pool = (cells.get(key) ?? []).sort((a, b) => list[b].area - list[a].area);
    if (pool.length === 0) throw new Error(`${path}: cell ${key} is empty`);

    // Grow out from the biggest shape until nothing else is within reach. A
    // satellite two hops out -- a sparkle beside a bubble beside a body -- comes
    // along, which is why this loops instead of testing against the body alone.
    const keep = new Set([pool[0]]);
    const rest = new Set(pool.slice(1));
    let box0 = { ...list[pool[0]] };
    for (let grew = true; grew;) {
      grew = false;
      for (const i of [...rest]) {
        if (!near(box0, list[i])) continue;
        box0 = {
          ...box0,
          x0: Math.min(box0.x0, list[i].x0), x1: Math.max(box0.x1, list[i].x1),
          y0: Math.min(box0.y0, list[i].y0), y1: Math.max(box0.y1, list[i].y1),
        };
        keep.add(i); rest.delete(i); grew = true;
      }
    }

    const side = Math.round(Math.max(box0.x1 - box0.x0, box0.y1 - box0.y0) * (1 + 2 * MARGIN));
    const ox = Math.round((box0.x0 + box0.x1) / 2 - side / 2);
    const oy = Math.round((box0.y0 + box0.y1) / 2 - side / 2);

    // Cropped and masked in one pass. Anything outside the frame is transparent
    // -- a sticker may sit closer to the edge of the sheet than its own margin.
    const cut = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) {
      const sy = oy + y;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < side; x++) {
        const sx = ox + x;
        if (sx < 0 || sx >= w) continue;
        if (!keep.has(owner[sy * w + sx])) continue;
        const from = (sy * w + sx) * 4, to = (y * side + x) * 4;
        cut[to] = rgba[from]; cut[to + 1] = rgba[from + 1];
        cut[to + 2] = rgba[from + 2]; cut[to + 3] = rgba[from + 3];
      }
    }
    return encode(resample(cut, side, box), box);
  });
}
