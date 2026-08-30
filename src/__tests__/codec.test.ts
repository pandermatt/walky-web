import { describe, expect, it } from 'vitest';
import {
  CODEC_VERSION, FLAG_DEFLATED, FLAG_GENERATORS, FLAG_LABELS, FLAG_SPEED_MPS, LIMITS, ScenarioLinkError,
  base64UrlToBytes, bytesToBase64Url,
  decodeScenario, decodeScenarioBody, encodeScenario, encodeScenarioBody,
  scenarioHeader,
} from '../state/codec';
import { DEFAULT_SETTINGS, type Settings } from '../state/model';
import { SCENARIO_VERSION, type ScenarioCore, type SerializedAgent, type SerializedWall } from '../state/scenario';
import type { Point } from '../sim/geometry';
import type { RGB } from '../palette';

function core(over: Partial<ScenarioCore> = {}): ScenarioCore {
  return {
    version: SCENARIO_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    view: { targetX: 0, targetY: 0, zoomLevel: 0 },
    walls: [],
    agents: [],
    labels: [],
    generators: [],
    ...over,
  };
}

function wall(id: number, polygons: Point[][], over: Partial<SerializedWall> = {}): SerializedWall {
  return { id, polygons, color: [200, 30, 90], isGoal: false, isBorder: false, ...over };
}

function box(x: number, y: number, w = 40, h = 30): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function agent(x: number, y: number, over: Partial<SerializedAgent> = {}): SerializedAgent {
  return {
    x, y, originX: x, originY: y, goal: -1, arrived: false, color: [10, 200, 240],
    spawned: false, ...over,
  };
}

/** A map with a bit of everything, as a hand-drawn one has. */
function richScenario(): ScenarioCore {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    showVisibleLines: true,
    showConvexHull: false,
    showDebug: true,
    sound: false,
    speed: 2.15,
    pedestrianRadius: 21,
    personalSpace: 5,
    brushSize: 4,
    borderThickness: 33,
  };
  return core({
    settings,
    view: { targetX: 812.5, targetY: -344.25, zoomLevel: -3.5 },
    walls: [
      // A border frame: one wall, four overlapping bars.
      wall(7, [box(0, 0, 400, 12), box(0, 300, 400, 12), box(0, 0, 12, 312), box(388, 0, 12, 312)],
        { isBorder: true }),
      // A traced shape, which is the kind that is not outlined on its own.
      wall(8, [Array.from({ length: 24 }, (_, i): Point => [500 + i * 7, 100 + (i % 5) * 11])],
        { color: [12, 240, 60] }),
      wall(9, [box(900, 400)], { isGoal: true, color: [255, 200, 0] }),
    ],
    agents: [
      agent(50, 50, { goal: 9, color: [255, 200, 0] }),
      agent(64, 50, { goal: 9, color: [255, 200, 0], originX: 60, originY: 44 }),
      agent(78, 50, { goal: 9, color: [0, 0, 0], arrived: true }),
      agent(92, 62),
      agent(106, 62, { goal: 8, color: [12, 240, 60] }),
    ],
  });
}

/** A map the size of one somebody would actually share. */
function realisticScenario(): ScenarioCore {
  const walls = [
    wall(1, [box(0, 0, 600, 14), box(0, 400, 600, 14), box(0, 0, 14, 414), box(586, 0, 14, 414)]),
    wall(2, [box(180, 120, 60, 160)]),
    wall(3, [box(340, 120, 60, 160)]),
    wall(4, [Array.from({ length: 24 }, (_, i): Point => [200 + i * 9, 320 + (i % 6) * 7])],
      {}),
    wall(5, [box(430, 320, 40, 40)]),
    wall(6, [box(520, 40, 50, 50)], { isGoal: true, color: [255, 190, 0] }),
  ];
  const agents: SerializedAgent[] = [];
  for (let i = 0; i < 150; i++) {
    const x = 40 + (i % 15) * 26;
    const y = 40 + Math.floor(i / 15) * 26;
    agents.push(agent(x, y, { goal: 6, color: [255, 190, 0] }));
  }
  return core({
    view: { targetX: 300, targetY: 200, zoomLevel: 1 },
    walls,
    agents,
  });
}

describe('the scenario codec', () => {
  it('round trips an empty map, and costs almost nothing to do it', () => {
    const empty = core();
    expect(decodeScenario(encodeScenario(empty))).toEqual(empty);
    expect(encodeScenario(empty).length).toBeLessThanOrEqual(24);
  });

  it('round trips a map with a bit of everything on it', () => {
    const before = richScenario();
    expect(decodeScenario(encodeScenario(before))).toEqual(before);
  });

  it('keeps every wall vertex and pedestrian position exactly, because they are whole numbers', () => {
    const before = realisticScenario();
    const after = decodeScenario(encodeScenario(before));
    expect(after.walls.flatMap((w) => w.polygons.flat()))
      .toEqual(before.walls.flatMap((w) => w.polygons.flat()));
    expect(after.agents.map((a) => [a.x, a.y])).toEqual(before.agents.map((a) => [a.x, a.y]));
  });

  it('rounds a wall vertex that somehow is not whole, rather than refusing it', () => {
    const before = core({ walls: [wall(1, [[[10.4, 20.6], [50, 20], [50, 60]]])] });
    expect(decodeScenario(encodeScenario(before)).walls[0].polygons[0][0]).toEqual([10, 21]);
  });

  it('keeps the camera within a sixteenth of a unit, and the zoom finer still', () => {
    const before = core({ view: { targetX: 812.53, targetY: -344.29, zoomLevel: -3.51 } });
    const after = decodeScenario(encodeScenario(before));
    expect(Math.abs(after.view.targetX - 812.53)).toBeLessThanOrEqual(1 / 16);
    expect(Math.abs(after.view.targetY - -344.29)).toBeLessThanOrEqual(1 / 16);
    expect(Math.abs(after.view.zoomLevel - -3.51)).toBeLessThanOrEqual(1 / 256);
  });

  it('keeps the border flag, so a frame does not come back as an ordinary wall', () => {
    const before = core({
      walls: [wall(20, [box(0, 0)], { isBorder: true }), wall(21, [box(200, 0)])],
    });
    const after = decodeScenario(encodeScenario(before));
    expect(after.walls.map((w) => w.isBorder)).toEqual([true, false]);
  });

  it('carries every goal to the right wall, and drops one that names no wall', () => {
    const before = core({
      walls: [wall(11, [box(0, 0)]), wall(12, [box(60, 0)]), wall(13, [box(120, 0)], { isGoal: true })],
      agents: [agent(5, 5, { goal: 13 }), agent(6, 6, { goal: 11 }), agent(7, 7, { goal: 999 })],
    });
    const after = decodeScenario(encodeScenario(before));
    expect(after.agents.map((a) => a.goal)).toEqual([13, 11, -1]);
    expect(after.walls.map((w) => w.isGoal)).toEqual([false, false, true]);
  });

  it('survives coordinates at the edges of what a varint changes shape at', () => {
    const values = [0, 1, -1, 63, 64, 127, 128, -128, 16383, 16384, -16384, 2 ** 21, -(2 ** 21)];
    const pairs = values.map((v): Point => [v, v === 0 ? 0 : -v]);
    const after = decodeScenario(encodeScenario(core({ agents: pairs.map((p) => agent(p[0], p[1])) })));
    expect(after.agents.map((a): Point => [a.x, a.y])).toEqual(pairs);
  });

  it('spends under 1200 bytes on a map somebody would really share', () => {
    const bytes = encodeScenario(realisticScenario());
    expect(bytes.length).toBeLessThan(1200);
    expect(bytesToBase64Url(bytes).length).toBeLessThan(LINK_BUDGET);
  });

  it('spends under eight bytes on a pedestrian in a brushed block', () => {
    const agents = Array.from({ length: 200 }, (_, i) =>
      agent(40 + (i % 20) * 26, 40 + Math.floor(i / 20) * 26, { goal: 1, color: [255, 190, 0] }));
    const withCrowd = encodeScenario(core({ walls: [wall(1, [box(0, 0)])], agents }));
    const withoutCrowd = encodeScenario(core({ walls: [wall(1, [box(0, 0)])] }));
    expect((withCrowd.length - withoutCrowd.length) / 200).toBeLessThan(8);
  });

  it('clamps settings and zoom that arrive out of range', () => {
    const before = core({
      settings: { ...DEFAULT_SETTINGS, speed: 9999, pedestrianRadius: 0, borderThickness: 500 },
      view: { targetX: 0, targetY: 0, zoomLevel: -400 },
    });
    const after = decodeScenario(encodeScenario(before));
    expect(after.settings.speed).toBe(3);
    expect(after.settings.pedestrianRadius).toBe(3);
    expect(after.settings.borderThickness).toBe(60);
    expect(after.view.zoomLevel).toBe(-50);
  });
});

describe('labels, which ride in the flags rather than in the version', () => {
  const written = () => core({
    labels: [
      { at: [10, -20], text: 'Main hall', size: 28, weight: 1000 },
      { at: [400, 90], text: 'Fire exit — north', size: 64, weight: 300 },
    ],
  });

  it('round trips the words, where they were put, and how they were written', () => {
    expect(decodeScenario(encodeScenario(written())).labels).toEqual([
      { at: [10, -20], text: 'Main hall', size: 28, weight: 1000 },
      { at: [400, 90], text: 'Fire exit — north', size: 64, weight: 300 },
    ]);
  });

  it('announces itself in the header, and only when there is something to announce', () => {
    // The promise to every link already pasted somewhere: a map with nothing
    // written on it announces nothing about labels. (Every body now rides with
    // FLAG_SPEED_MPS -- the speed unit changed for all maps alike, see codec.ts.)
    expect(encodeScenario(core())[2]).toBe(FLAG_SPEED_MPS);
    expect(encodeScenario(written())[2]).toBe(FLAG_SPEED_MPS | FLAG_LABELS);
  });

  it('is not read at all when the header did not promise it', () => {
    const bytes = encodeScenario(written());
    bytes[2] = 0;
    // The block is still there, so a reader told to ignore it has bytes left
    // over -- which is the truncation check doing its job rather than a map
    // quietly missing its labels.
    expect(() => decodeScenario(bytes)).toThrow(/cut short or damaged/);
  });

  it('refuses more labels than it could hold, without allocating them', () => {
    const bytes = encodeScenario(written());
    // The count is the first byte of the block, which a two-label payload puts
    // one byte from the end of everything the labels themselves wrote.
    const body = [...encodeScenarioBody(core()), 0x80, 0x80, 0x80, 0x02];
    const forged = new Uint8Array(body.length + 3);
    forged.set([bytes[0], bytes[1], FLAG_LABELS], 0);
    forged.set(body, 3);
    expect(() => decodeScenario(forged)).toThrow(/more labels than Walky can hold/);
  });

  it('refuses a label longer than it could hold', () => {
    const long = core({
      labels: [{ at: [0, 0], size: 28, weight: 1000, text: 'x'.repeat(LIMITS.maxLabelBytes + 10) }],
    });
    const bytes = encodeScenario(long);
    expect(() => decodeScenario(bytes)).toThrow(/longer label than Walky can hold/);
  });
});

describe('generators, which ride in the flags as the labels do', () => {
  const doors = () => core({
    walls: [wall(4, [[[0, 0], [40, 0], [40, 40]]], { isGoal: true })],
    generators: [
      { at: [200, -40], rate: 3, goal: 4, color: [200, 30, 90] },
      { at: [640, 120], rate: 17, goal: -1, color: [255, 255, 255] },
    ],
  });

  it('round trips where the door is, how fast it runs and what it is aimed at', () => {
    expect(decodeScenario(encodeScenario(doors())).generators).toEqual([
      { at: [200, -40], rate: 3, goal: 4, color: [200, 30, 90] },
      { at: [640, 120], rate: 17, goal: -1, color: [255, 255, 255] },
    ]);
  });

  it('announces itself in the header, and only when there is something to announce', () => {
    // The same promise the labels make: a map with no door on it announces
    // no generators block.
    expect(encodeScenario(core())[2]).toBe(FLAG_SPEED_MPS);
    expect(encodeScenario(doors())[2]).toBe(FLAG_SPEED_MPS | FLAG_GENERATORS);
  });

  it('sits after the labels, so a map can carry both', () => {
    const both = core({
      labels: [{ at: [0, 0], text: 'Gate', size: 28, weight: 1000 }],
      generators: [{ at: [10, 10], rate: 4, goal: -1, color: [255, 255, 255] }],
    });
    expect(encodeScenario(both)[2]).toBe(FLAG_SPEED_MPS | FLAG_LABELS | FLAG_GENERATORS);
    const after = decodeScenario(encodeScenario(both));
    expect(after.labels).toEqual(both.labels);
    expect(after.generators).toEqual(both.generators);
  });

  it('is not read at all when the header did not promise it', () => {
    const bytes = encodeScenario(doors());
    bytes[2] = 0;
    expect(() => decodeScenario(bytes)).toThrow(/cut short or damaged/);
  });

  it('refuses more generators than it could hold, without allocating them', () => {
    const bytes = encodeScenario(doors());
    const body = [...encodeScenarioBody(core()), 0x80, 0x80, 0x80, 0x02];
    const forged = new Uint8Array(body.length + 3);
    forged.set([bytes[0], bytes[1], FLAG_GENERATORS], 0);
    forged.set(body, 3);
    expect(() => decodeScenario(forged)).toThrow(/more generators than Walky can hold/);
  });

  it('carries whether a pedestrian came out of one, on a bit the byte already had', () => {
    const before = core({
      agents: [agent(10, 10), agent(40, 10, { spawned: true })],
    });
    expect(decodeScenario(encodeScenario(before)).agents.map((a) => a.spawned))
      .toEqual([false, true]);
    // No flag of its own and no version bump: a spare bit of the agent byte.
    expect(encodeScenario(before)[2]).toBe(FLAG_SPEED_MPS);
    expect(encodeScenario(before)[1]).toBe(CODEC_VERSION);
  });
});

const LINK_BUDGET = 2000;

describe('a link the codec will not accept', () => {
  it('refuses an empty buffer', () => {
    expect(() => decodeScenario(new Uint8Array(0))).toThrow(ScenarioLinkError);
  });

  it('refuses something that is not a Walky payload', () => {
    const bytes = encodeScenario(core());
    bytes[0] = 0x58;
    expect(() => decodeScenario(bytes)).toThrow(/does not look like a Walky link/);
  });

  it('refuses a version it does not know, in either direction', () => {
    // Older matters as much as newer: a payload written before a field was
    // dropped misreads exactly as badly as one written after a field was added,
    // and there is no skipping an unknown field in a delta stream.
    for (const version of [CODEC_VERSION + 1, CODEC_VERSION - 1]) {
      const bytes = encodeScenario(core());
      bytes[1] = version;
      expect(() => decodeScenario(bytes)).toThrow(/different version of Walky/);
    }
  });

  it('refuses a flag it does not know', () => {
    const bytes = encodeScenario(core());
    bytes[2] = 0x40;
    expect(() => decodeScenario(bytes)).toThrow(/different version of Walky/);
  });

  it('sends a deflated payload to the link reader rather than guessing at it', () => {
    const body = encodeScenarioBody(core());
    const bytes = new Uint8Array(body.length + 3);
    bytes.set(scenarioHeader(FLAG_DEFLATED), 0);
    bytes.set(body, 3);
    expect(() => decodeScenario(bytes)).toThrow(/packed/);
  });

  it('refuses every truncation of a real payload, rather than returning half a map', () => {
    const bytes = encodeScenario(richScenario());
    for (let n = 1; n < bytes.length; n++) {
      expect(() => decodeScenario(bytes.subarray(0, n))).toThrow(ScenarioLinkError);
    }
  });

  it('refuses a payload with a byte left over', () => {
    const bytes = encodeScenario(richScenario());
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes, 0);
    expect(() => decodeScenario(longer)).toThrow(/cut short or damaged/);
  });

  it('refuses a count it could never hold, without trying to allocate it', () => {
    // Settings, then a zeroed view, then a wall count of a hundred million.
    const body = [0, 4, 13, 30, 1, 12, 0, 0, 0, 0x80, 0x99, 0xef, 0x2f];
    const bytes = Uint8Array.from([0x57, CODEC_VERSION, 0, ...body]);
    expect(() => decodeScenario(bytes)).toThrow(/more walls than Walky can hold/);
  });

  it('refuses more points than the visibility graph could face', () => {
    const polygons = Array.from({ length: 40 }, (_, k) =>
      Array.from({ length: 600 }, (_, i): Point => [k * 10 + i, i]));
    const bytes = encodeScenario(core({ walls: [wall(1, polygons)] }));
    expect(() => decodeScenario(bytes)).toThrow(/more points than Walky can hold/);
    expect(40 * 600).toBeGreaterThan(LIMITS.maxTotalPoints);
  });

  it('refuses deltas that walk the cursor off the map, however legal each step is', () => {
    // One wall, one triangle, with each vertex a legal step but the run heading
    // far past maxCoord.
    const far = LIMITS.maxCoord + 1000;
    const bytes = encodeScenario(core({ walls: [wall(1, [[[far, 0], [far + 10, 0], [far, 10]]])] }));
    expect(() => decodeScenario(bytes)).toThrow(/off the map/);
  });

  it('refuses a body that is only a header', () => {
    expect(() => decodeScenarioBody(new Uint8Array(0))).toThrow(ScenarioLinkError);
  });
});

describe('base64url', () => {
  it('round trips any run of bytes', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 17, 64, 255, 300]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it('writes only characters a URL carries untouched', () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff);
    const text = bytesToBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(encodeURIComponent(text)).toBe(text);
  });

  it('refuses the standard alphabet, which is what a mangled link arrives as', () => {
    expect(() => base64UrlToBytes('ab+d')).toThrow(ScenarioLinkError);
    expect(() => base64UrlToBytes('ab/d')).toThrow(ScenarioLinkError);
    expect(() => base64UrlToBytes('abcd=')).toThrow(ScenarioLinkError);
  });

  it('refuses a length that cannot be a whole number of bytes', () => {
    expect(() => base64UrlToBytes('abcde')).toThrow(ScenarioLinkError);
  });
});

describe('what the codec deliberately does not carry', () => {
  it('recomputes the version rather than trusting the one it was handed', () => {
    const before = core({ version: 99 });
    expect(decodeScenario(encodeScenario(before)).version).toBe(SCENARIO_VERSION);
  });

  it('keeps a pedestrian colour that is not derivable from its goal', () => {
    // The common case before any goal is marked: a crowd of random bright
    // colours, none of which could be worked out again from the map.
    const colors: RGB[] = [[200, 10, 10], [10, 200, 10], [10, 10, 200]];
    const before = core({ agents: colors.map((color, i) => agent(i * 30, 0, { color })) });
    expect(decodeScenario(encodeScenario(before)).agents.map((a) => a.color)).toEqual(colors);
  });
});
