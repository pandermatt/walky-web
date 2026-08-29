import { describe, expect, it } from 'vitest';
import {
  LINK_PREFIX, ScenarioLinkError,
  decodeLink, encodeLink, readSharedPayload, shareUrl, stripHash,
} from '../state/shareLink';
import { bytesToBase64Url, encodeScenario, encodeScenarioBody, scenarioHeader } from '../state/codec';
import { DEFAULT_SETTINGS } from '../state/model';
import { SCENARIO_VERSION, type ScenarioCore, type SerializedAgent } from '../state/scenario';
import type { Point } from '../sim/geometry';

function core(over: Partial<ScenarioCore> = {}): ScenarioCore {
  return {
    version: SCENARIO_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    view: { targetX: 0, targetY: 0, zoomLevel: 0 },
    walls: [],
    agents: [],
    ...over,
  };
}

function box(x: number, y: number): Point[] {
  return [[x, y], [x + 40, y], [x + 40, y + 30], [x, y + 30]];
}

/** Big and repetitive: the shape deflate is actually able to help with. */
function bigCrowd(): ScenarioCore {
  const agents: SerializedAgent[] = [];
  for (let i = 0; i < 1500; i++) {
    agents.push({
      x: 40 + (i % 50) * 26,
      y: 40 + Math.floor(i / 50) * 26,
      originX: 40 + (i % 50) * 26,
      originY: 40 + Math.floor(i / 50) * 26,
      goal: 1,
      arrived: false,
      color: [255, 190, 0],
    });
  }
  return core({ walls: [{ id: 1, polygons: [box(0, 0)], color: [255, 190, 0], isGoal: true, outlinedAlone: true }], agents });
}

describe('a map as a link', () => {
  it('round trips through the whole link path', async () => {
    const before = core({
      view: { targetX: 120.5, targetY: -80.25, zoomLevel: -2 },
      walls: [{ id: 4, polygons: [box(0, 0)], color: [1, 2, 3], isGoal: true, outlinedAlone: false }],
      agents: [{ x: 10, y: 10, originX: 10, originY: 10, goal: 4, arrived: false, color: [1, 2, 3] }],
    });
    expect(await decodeLink(await encodeLink(before))).toEqual(before);
  });

  it('writes a fragment that a URL carries untouched', async () => {
    const link = await encodeLink(bigCrowd());
    expect(link.startsWith(LINK_PREFIX)).toBe(true);
    expect(encodeURI(link)).toBe(link);
  });

  it('deflates a big repetitive crowd, and the result still decodes', async () => {
    const scenario = bigCrowd();
    const raw = bytesToBase64Url(encodeScenario(scenario)).length;
    const link = (await encodeLink(scenario)).slice(LINK_PREFIX.length);
    expect(link.length).toBeLessThan(raw);
    expect(await decodeLink(link)).toEqual(scenario);
  });

  it('never hands back a link longer than the plain encoding, whatever deflate does', async () => {
    // Deflate is kept only when it wins. It usually does -- even an empty map is
    // mostly zero bytes -- but the encoder is not allowed to make a link worse.
    for (const scenario of [core(), bigCrowd()]) {
      const link = (await encodeLink(scenario)).slice(LINK_PREFIX.length);
      expect(link.length).toBeLessThanOrEqual(bytesToBase64Url(encodeScenario(scenario)).length);
      expect(await decodeLink(link)).toEqual(scenario);
    }
  });

  it('reads a raw payload as happily as a deflated one', async () => {
    const scenario = core({ walls: [{ id: 1, polygons: [box(5, 5)], color: [9, 9, 9], isGoal: false, outlinedAlone: true }] });
    const raw = bytesToBase64Url(encodeScenario(scenario));
    expect(await decodeLink(raw)).toEqual(scenario);
  });

  it('accepts a whole fragment as well as the payload alone', async () => {
    const link = await encodeLink(core());
    expect(await decodeLink(link)).toEqual(core());
    expect(await decodeLink(link.slice(LINK_PREFIX.length))).toEqual(core());
  });

  it('refuses a deflated payload whose bytes have been damaged', async () => {
    const body = encodeScenarioBody(bigCrowd());
    const bytes = new Uint8Array(body.length + 3);
    bytes.set(scenarioHeader(1), 0);
    bytes.set(body, 3); // flagged deflated, but never actually deflated
    await expect(decodeLink(bytesToBase64Url(bytes))).rejects.toThrow(ScenarioLinkError);
  });

  it('refuses an empty payload', async () => {
    await expect(decodeLink('')).rejects.toThrow(/does not look like a Walky link/);
  });

  it('refuses a truncated link rather than opening half a map', async () => {
    const link = (await encodeLink(bigCrowd())).slice(LINK_PREFIX.length);
    await expect(decodeLink(link.slice(0, link.length - 8))).rejects.toThrow(ScenarioLinkError);
  });
});

describe('the fragment', () => {
  it('finds the map, wherever in the fragment it sits', () => {
    expect(readSharedPayload('#m=abc')).toBe('abc');
    expect(readSharedPayload('m=abc')).toBe('abc');
    expect(readSharedPayload('#x=1&m=abc')).toBe('abc');
    expect(readSharedPayload('#m=abc&x=1')).toBe('abc');
  });

  it('finds nothing when there is nothing to find', () => {
    expect(readSharedPayload('')).toBeNull();
    expect(readSharedPayload('#')).toBeNull();
    expect(readSharedPayload('#m=')).toBeNull();
    expect(readSharedPayload('#n=abc')).toBeNull();
    expect(readSharedPayload('#mm=abc')).toBeNull();
  });

  it('hands back garbage rather than judging it -- the decoder is the validator', () => {
    expect(readSharedPayload('#m=!!!!')).toBe('!!!!');
  });

  it('is dropped from a URL without disturbing the query', () => {
    expect(stripHash('https://walky.example/app/?a=1#m=abc')).toBe('https://walky.example/app/?a=1');
    expect(stripHash('https://walky.example/app/')).toBe('https://walky.example/app/');
  });

  it('makes a shareable URL out of the page it was asked about', async () => {
    const url = await shareUrl(core(), 'https://walky.example/app/?a=1#m=stale');
    expect(url.startsWith('https://walky.example/app/?a=1#m=')).toBe(true);
    expect(await decodeLink(url.slice(url.indexOf('#')))).toEqual(core());
  });
});
