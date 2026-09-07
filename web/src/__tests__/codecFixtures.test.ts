import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { encodeScenario } from '../state/codec';
import { FIXTURES } from '../../tools/codecScenarios';

/**
 * The ratchet on the codec fixtures the Swift port is checked against.
 *
 * Without this a change to codec.ts would leave the committed bytes describing
 * a format nothing writes any more, and the Swift suite would go on passing
 * against them for as long as nobody looked. Failing here forces the
 * regeneration and the matching Swift change into the same commit, which is
 * what stops the port rotting -- exactly what goldenTrace.test.ts does for the
 * simulation traces.
 *
 *   npx vite-node tools/codecFixtures.ts
 */
const DIR = resolve(import.meta.dirname, '../../../ios/Fixtures/codec');

describe('codec fixtures', () => {
  for (const [name, scenario] of Object.entries(FIXTURES)) {
    it(`${name} still encodes to the committed bytes`, () => {
      const committed = new Uint8Array(readFileSync(resolve(DIR, `${name}.wkcd`)));
      expect(Array.from(encodeScenario(scenario))).toEqual(Array.from(committed));
    });
  }

  it('the index still describes the fixtures', () => {
    const index = JSON.parse(readFileSync(resolve(DIR, 'index.json'), 'utf8'));
    expect(Object.keys(index).sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const [name, scenario] of Object.entries(FIXTURES)) {
      expect(index[name].walls).toBe(scenario.walls.length);
      expect(index[name].agents).toBe(scenario.agents.length);
      expect(index[name].speed).toBe(scenario.settings.speed);
    }
  });
});
