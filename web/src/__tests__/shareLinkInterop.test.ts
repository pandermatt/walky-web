import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeLink, encodeLink } from '../state/shareLink';
import { FIXTURES } from '../../tools/codecScenarios';

/**
 * The two ports' deflate, against each other.
 *
 * `CompressionStream('deflate-raw')` here and `COMPRESSION_ZLIB` on Apple's side
 * are supposed to be one format -- RFC 1951, no zlib wrapper, no checksum -- but
 * the names agree about nothing, so both directions are checked rather than
 * assumed. Get this wrong and every link shared between a phone and a browser is
 * unopenable, with no other symptom.
 *
 * `swift-made.link` was written by the Swift suite and committed. It does not
 * regenerate from here, and it does not need to: it is a proof that the formats
 * met once, not a description of anything this repo can change. `deflated.link`
 * goes the other way and *is* regenerated, by tools/codecFixtures.ts.
 */
const DIR = resolve(import.meta.dirname, '../../../ios/Fixtures/codec');

describe('share link interop', () => {
  it('reads a deflated link the Swift port produced', async () => {
    const link = readFileSync(resolve(DIR, 'swift-made.link'), 'utf8').trim();
    const core = await decodeLink(link);

    expect(core.agents).toHaveLength(400);
    expect(core.walls).toHaveLength(1);
    expect(core.labels).toHaveLength(2);
    expect(core.generators).toHaveLength(2);
    expect(core.agents[0].color).toEqual([255, 200, 0]);
    expect(core.agents.every(a => a.goal === core.walls[0].id)).toBe(true);
    expect(core.labels?.[0].text).toBe('Hauptbahnhof');
  });

  it('the deflated fixture the Swift port reads really is deflated', async () => {
    // Otherwise the Swift test that opens it would prove nothing about deflate.
    const link = readFileSync(resolve(DIR, 'deflated.link'), 'utf8').trim();
    const core = await decodeLink(link);
    expect(core.agents).toHaveLength(400);
  });

  it('a link round-trips through this port too', async () => {
    const core = await decodeLink(await encodeLink(FIXTURES.labelsAndGenerators));
    expect(core.walls).toEqual(FIXTURES.labelsAndGenerators.walls);
    expect(core.labels).toEqual(FIXTURES.labelsAndGenerators.labels);
  });
});
