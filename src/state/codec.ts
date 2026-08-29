import type { RGB } from '../palette';
import type { Point } from '../sim/geometry';
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../render/viewport';
import {
  SCENARIO_VERSION, clampSettings,
  type ScenarioCore, type SerializedAgent, type SerializedWall,
} from './scenario';
import type { Settings } from './model';

/**
 * The map as a compact byte string, so it fits in a URL.
 *
 * The same scenario as JSON runs to tens of kilobytes; a six-wall map with a
 * hundred and fifty pedestrians comes to about a kilobyte here. Three things
 * buy that:
 *
 *   Varints. Almost every number in a map is small -- a point count, a colour
 *   channel, a slider value -- and JSON spends a byte per digit plus punctuation
 *   on all of them.
 *
 *   Deltas. One running cursor walks every wall vertex in the payload, and
 *   another walks the crowd. Polygon vertices are a few units apart and a
 *   brushed block of pedestrians is a lattice, so four-digit coordinates become
 *   one-byte numbers. A map drawn far from the origin costs no more than one
 *   drawn on it.
 *
 *   No floats. Every wall vertex and every pedestrian position in Walky is
 *   already a whole number -- the tools round on commit (wallTool.ts:127,
 *   rectangleTool.ts:84, borderTool.ts:101), the brush rounds (app.ts:607), and
 *   a step is one lattice square -- so storing them as integers is exact rather
 *   than merely close enough. Only the camera is fractional, and it gets just
 *   enough sub-unit precision to be invisible.
 *
 * Because there is no float on the wire, NaN and Infinity are unrepresentable:
 * a whole class of bad input cannot be expressed, let alone decoded.
 *
 * Everything here is synchronous and touches no platform API -- no window, no
 * location, no btoa -- so it can be tested in full without a browser. The
 * optional deflate pass lives in shareLink.ts, which is where the asynchrony
 * belongs.
 */

/** 'W'. A link that does not start with this was not made by Walky. */
const MAGIC = 0x57;

/**
 * The wire format's own version, independent of SCENARIO_VERSION: the JSON
 * report can gain a descriptive field without invalidating every link already
 * pasted, and the byte layout can change without renumbering the report.
 *
 * Unknown versions are rejected outright rather than tolerated -- in either
 * direction, since a payload from before a field was dropped misreads exactly as
 * badly as one from after a field was added. Over a delta stream there is no
 * other option: a field whose length you do not know cannot be skipped. So
 * additive changes go in the flags byte instead, where a bit announces a block an
 * older build can refuse by name.
 *
 * Version 2 dropped the tree block along with trees themselves; version 3
 * dropped the per-wall outlinedAlone bit, since every shape is hulled now.
 */
export const CODEC_VERSION = 3;

/** The body is deflate-raw rather than the bytes written here. Set by shareLink.ts. */
export const FLAG_DEFLATED = 1;

/** Every bit that means something. Anything else set is a payload from the future. */
const KNOWN_FLAGS = FLAG_DEFLATED;

/** Sub-unit precision for the one thing in a map that is not a whole number. */
const VIEW_QUANTUM = 16;  // at the deepest zoom a 16th of a unit is under 4px
const ZOOM_QUANTUM = 256; // a pinch lands between the wheel's whole notches

/**
 * Ceilings on the payload, checked before anything is allocated.
 *
 * A link is untrusted input: without these, five bytes claiming four billion
 * pedestrians would be an out-of-memory crash rather than an error message. The
 * caps are the whole security story here -- there is no eval, no HTML and no
 * network in this path, so the worst a hostile link can do is be heavy.
 *
 * MAX_TOTAL_POINTS is the one that is load-bearing rather than a formality: the
 * visibility graph is O(n^2) over wall corners, so a link that decodes in
 * milliseconds can lock the tab up for minutes on the rebuild that follows. It
 * is far above any map drawn by hand -- a traced shape simplifies to about 23
 * points -- and far below where the rebuild stops being interactive.
 */
export const LIMITS = {
  maxWalls: 2_000,
  maxPolygonsPerWall: 64,   // a border frame is four bars
  maxPointsPerPolygon: 4_096,
  maxTotalPoints: 20_000,
  maxAgents: 100_000,
  /** Well inside the range where a Float32Array still holds integers exactly. */
  maxCoord: 1 << 22,
} as const;

/** A link that cannot be read, with a sentence that can be shown to a person. */
export class ScenarioLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioLinkError';
  }
}

const TRUNCATED = 'that link is cut short or damaged';
const NOT_WALKY = 'that does not look like a Walky link';
const WRONG_VERSION = 'that link was made by a different version of Walky';

// ---- bytes in, bytes out ---------------------------------------------------

class Writer {
  private bytes: number[] = [];

  byte(v: number): void {
    this.bytes.push(v & 0xff);
  }

  /** LEB128: seven bits per byte, high bit set while more follow. */
  varint(v: number): void {
    let n = Math.max(0, Math.round(v));
    while (n >= 0x80) {
      this.bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }

  /** Zigzag, so a small negative delta costs one byte like a small positive one. */
  zigzag(v: number): void {
    const n = Math.round(v);
    this.varint(n < 0 ? -2 * n - 1 : 2 * n);
  }

  rgb(c: RGB): void {
    this.byte(c[0]);
    this.byte(c[1]);
    this.byte(c[2]);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private at = 0;
  /** Ring points seen so far, against LIMITS.maxTotalPoints. */
  points = 0;

  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new ScenarioLinkError(TRUNCATED);
    return this.bytes[this.at++];
  }

  varint(): number {
    let shift = 1;
    let out = 0;
    for (;;) {
      const b = this.byte();
      out += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) return out;
      shift *= 0x80;
      // Past this a varint can no longer be an exact integer, so it is
      // corruption rather than a number: stop before the value goes quietly wrong.
      if (shift > Number.MAX_SAFE_INTEGER) throw new ScenarioLinkError(TRUNCATED);
    }
  }

  zigzag(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  rgb(): RGB {
    return [this.byte(), this.byte(), this.byte()];
  }

  /** A count, refused before it is used to size anything. */
  count(limit: number, what: string): number {
    const n = this.varint();
    if (n > limit) throw new ScenarioLinkError(`that link claims more ${what} than Walky can hold`);
    return n;
  }

  /**
   * A cursor step. Each delta on its own can be legal while the running total
   * walks off to a billion, so the position is checked rather than the step.
   */
  step(from: number): number {
    const to = from + this.zigzag();
    if (!(Math.abs(to) <= LIMITS.maxCoord)) throw new ScenarioLinkError('that link is off the map');
    return to;
  }

  ring(n: number): void {
    this.points += n;
    if (this.points > LIMITS.maxTotalPoints) {
      throw new ScenarioLinkError('that link claims more points than Walky can hold');
    }
  }

  get done(): boolean {
    return this.at >= this.bytes.length;
  }
}

/** The order the toggle bits are packed in. Append only: the position is the format. */
const TOGGLE_KEYS = [
  'showVisibleLines', 'showLineToTarget', 'showConvexHull', 'showConvexParts',
  'showPreferredRadius', 'showDebug', 'sound',
] as const;

/** The order the numeric settings are packed in. Append only, as above. */
const NUMBER_KEYS = [
  'speed', 'pedestrianRadius', 'preferredSpace', 'brushSize', 'borderThickness',
] as const;

const AGENT_ARRIVED = 1;
const AGENT_ORIGIN_DIFFERS = 2;
const AGENT_COLOR_REPEATS = 4;

const WALL_IS_GOAL = 1;
const WALL_IS_BORDER = 2;

// ---- header ----------------------------------------------------------------

export function scenarioHeader(flags: number): Uint8Array {
  return Uint8Array.from([MAGIC, CODEC_VERSION, flags & 0xff]);
}

/**
 * Splits a payload into its flags and its body, checking the header is one this
 * build can read. Nothing is decoded here -- the body may still be deflated.
 */
export function readHeader(bytes: Uint8Array): { flags: number; body: Uint8Array } {
  if (bytes.length < 3) throw new ScenarioLinkError(TRUNCATED);
  if (bytes[0] !== MAGIC) throw new ScenarioLinkError(NOT_WALKY);
  if (bytes[1] !== CODEC_VERSION) throw new ScenarioLinkError(WRONG_VERSION);
  const flags = bytes[2];
  if ((flags & ~KNOWN_FLAGS) !== 0) throw new ScenarioLinkError(WRONG_VERSION);
  return { flags, body: bytes.subarray(3) };
}

// ---- writing ---------------------------------------------------------------

/** The scenario as bytes: a three-byte header followed by the body. */
export function encodeScenario(core: ScenarioCore): Uint8Array {
  const body = encodeScenarioBody(core);
  const out = new Uint8Array(body.length + 3);
  out.set(scenarioHeader(0), 0);
  out.set(body, 3);
  return out;
}

/** The body alone, which is the part shareLink.ts may deflate. */
export function encodeScenarioBody(core: ScenarioCore): Uint8Array {
  const w = new Writer();

  const s = core.settings;
  let toggles = 0;
  TOGGLE_KEYS.forEach((key, i) => { if (s[key]) toggles |= 1 << i; });
  w.varint(toggles);
  for (const key of NUMBER_KEYS) w.varint(s[key]);

  w.zigzag(Math.round(core.view.targetX * VIEW_QUANTUM));
  w.zigzag(Math.round(core.view.targetY * VIEW_QUANTUM));
  w.zigzag(Math.round(core.view.zoomLevel * ZOOM_QUANTUM));

  // One cursor for every vertex of every shape of every wall, and a second one
  // for the crowd. A map drawn at x=3000 costs the 3000 once, not once per ring.
  w.varint(core.walls.length);
  let cx = 0;
  let cy = 0;
  let previousId = 0;
  core.walls.forEach((wall, index) => {
    // Two flags so far, and a whole byte for them: the room is what let the
    // border flag be added without the format needing a new version. A link
    // from before it simply has the bit clear, which is an ordinary wall.
    w.byte((wall.isGoal ? WALL_IS_GOAL : 0) | (wall.isBorder ? WALL_IS_BORDER : 0));
    w.rgb(wall.color);
    // Ids run upward from a counter that never resets, so after the first one a
    // delta is almost always a single byte.
    if (index === 0) w.varint(wall.id);
    else w.zigzag(wall.id - previousId);
    previousId = wall.id;

    w.varint(wall.polygons.length);
    for (const poly of wall.polygons) {
      w.varint(poly.length);
      for (const point of poly) {
        const x = Math.round(point[0]);
        const y = Math.round(point[1]);
        w.zigzag(x - cx);
        w.zigzag(y - cy);
        cx = x;
        cy = y;
      }
    }
  });

  // Goals travel as the wall's index in this payload, not its id: an index is a
  // smaller number, and remapping onto fresh ids is the importer's job anyway.
  const indexOfId = new Map<number, number>();
  core.walls.forEach((wall, i) => indexOfId.set(wall.id, i));

  w.varint(core.agents.length);
  let ax = 0;
  let ay = 0;
  let previousColor = -1;
  for (const agent of core.agents) {
    const x = Math.round(agent.x);
    const y = Math.round(agent.y);
    const ox = Math.round(agent.originX);
    const oy = Math.round(agent.originY);
    const color = (agent.color[0] << 16) | (agent.color[1] << 8) | agent.color[2];

    let bits = agent.arrived ? AGENT_ARRIVED : 0;
    // A pedestrian that has not moved yet -- every one of them on a map that has
    // not been run -- pays nothing for its origin.
    if (ox !== x || oy !== y) bits |= AGENT_ORIGIN_DIFFERS;
    // A crowd heading for one goal wears one colour, so this is usually set and
    // the whole crowd costs three bytes between them.
    if (color === previousColor) bits |= AGENT_COLOR_REPEATS;
    w.byte(bits);

    w.zigzag(x - ax);
    w.zigzag(y - ay);
    if (bits & AGENT_ORIGIN_DIFFERS) { w.zigzag(ox - x); w.zigzag(oy - y); }
    if (!(bits & AGENT_COLOR_REPEATS)) w.rgb(agent.color);

    const index = indexOfId.get(agent.goal);
    w.varint(index === undefined ? 0 : index + 1);

    ax = x;
    ay = y;
    previousColor = color;
  }

  return w.finish();
}

// ---- reading ---------------------------------------------------------------

/** A whole payload, header included, back into a scenario. */
export function decodeScenario(bytes: Uint8Array): ScenarioCore {
  const { flags, body } = readHeader(bytes);
  if (flags & FLAG_DEFLATED) {
    // Inflating is shareLink.ts's job; this entry point is the synchronous one.
    throw new ScenarioLinkError('that link is packed and must be opened through a link reader');
  }
  return decodeScenarioBody(body);
}

/** The body alone, once any deflate wrapper has been undone. */
export function decodeScenarioBody(bytes: Uint8Array): ScenarioCore {
  const r = new Reader(bytes);

  const toggles = r.varint();
  const settings: Partial<Settings> = {};
  TOGGLE_KEYS.forEach((key, i) => { settings[key] = (toggles & (1 << i)) !== 0; });
  for (const key of NUMBER_KEYS) settings[key] = r.varint();

  const view = {
    targetX: r.step(0) / VIEW_QUANTUM,
    targetY: r.step(0) / VIEW_QUANTUM,
    zoomLevel: Math.min(
      ZOOM_LEVEL_MAX,
      Math.max(ZOOM_LEVEL_MIN, r.zigzag() / ZOOM_QUANTUM),
    ),
  };

  const wallCount = r.count(LIMITS.maxWalls, 'walls');
  const walls: SerializedWall[] = [];
  let cx = 0;
  let cy = 0;
  let previousId = 0;
  for (let i = 0; i < wallCount; i++) {
    const bits = r.byte();
    const color = r.rgb();
    const id = i === 0 ? r.varint() : previousId + r.zigzag();
    previousId = id;

    const polygonCount = r.count(LIMITS.maxPolygonsPerWall, 'shapes in a wall');
    const polygons: Point[][] = [];
    for (let p = 0; p < polygonCount; p++) {
      const pointCount = r.count(LIMITS.maxPointsPerPolygon, 'points in a shape');
      r.ring(pointCount);
      const poly: Point[] = [];
      for (let n = 0; n < pointCount; n++) {
        cx = r.step(cx);
        cy = r.step(cy);
        poly.push([cx, cy]);
      }
      polygons.push(poly);
    }
    walls.push({
      id,
      polygons,
      color,
      isGoal: (bits & WALL_IS_GOAL) !== 0,
      isBorder: (bits & WALL_IS_BORDER) !== 0,
    });
  }

  const agentCount = r.count(LIMITS.maxAgents, 'pedestrians');
  const agents: SerializedAgent[] = [];
  let ax = 0;
  let ay = 0;
  let previousColor: RGB = [0, 0, 0];
  for (let i = 0; i < agentCount; i++) {
    const bits = r.byte();
    ax = r.step(ax);
    ay = r.step(ay);
    const ox = (bits & AGENT_ORIGIN_DIFFERS) ? r.step(ax) : ax;
    const oy = (bits & AGENT_ORIGIN_DIFFERS) ? r.step(ay) : ay;
    const color = (bits & AGENT_COLOR_REPEATS) ? previousColor : r.rgb();
    previousColor = color;
    const goalIndex = r.varint();
    // A goal naming no wall is dropped rather than refused: the pedestrian is
    // simply unassigned, which is a state the map already has a meaning for.
    const goal = goalIndex > 0 && goalIndex <= walls.length ? walls[goalIndex - 1].id : -1;
    agents.push({
      x: ax,
      y: ay,
      originX: ox,
      originY: oy,
      goal,
      arrived: (bits & AGENT_ARRIVED) !== 0,
      color,
    });
  }

  // Everything decoded, and bytes still to go: the payload is not what it says
  // it is. Better an error than a map quietly missing its tail.
  if (!r.done) throw new ScenarioLinkError(TRUNCATED);

  return {
    version: SCENARIO_VERSION,
    settings: clampSettings(settings),
    view,
    walls,
    agents,
  };
}

// ---- base64url -------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * base64url, unpadded: the alphabet that rides in a fragment untouched -- no
 * percent-encoding, no `+`, `/` or `=`.
 *
 * Hand-rolled rather than btoa'd. btoa is a DOM function that takes a string of
 * charcodes, so it needs a binary-string dance and then the URL-safe alphabet
 * and the padding undone afterwards; the usual way to feed it,
 * String.fromCharCode(...bytes), throws outright past about a hundred thousand
 * arguments, which is exactly the size a large map reaches. This runs the same
 * in a browser and in a test, at any size.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (a << 16) | (b << 8) | c;
    const left = bytes.length - i;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    if (left > 1) out += ALPHABET[(chunk >> 6) & 63];
    if (left > 2) out += ALPHABET[chunk & 63];
  }
  return out;
}

const VALUES = (() => {
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET.charCodeAt(i)] = i;
  return map;
})();

export function base64UrlToBytes(text: string): Uint8Array {
  const n = text.length;
  // Four characters carry three bytes; a single trailing character carries none,
  // so a length of that shape can only be damage.
  if (n % 4 === 1) throw new ScenarioLinkError(TRUNCATED);
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let at = 0;
  let chunk = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? VALUES[code] : -1;
    if (value < 0) throw new ScenarioLinkError(NOT_WALKY);
    chunk = (chunk << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (chunk >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}
