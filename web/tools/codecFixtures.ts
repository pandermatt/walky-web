/**
 * Writes the codec fixtures the Swift port is checked against.
 *
 *   npx vite-node tools/codecFixtures.ts
 *
 * Bytes, not JSON, for the same reason the trace fixtures are binary: the thing
 * under test *is* the byte layout, and any format that pretty-prints it hides
 * exactly the disagreements worth catching.
 *
 * Each fixture is one encoded ScenarioCore. The Swift side decodes it and
 * re-encodes it, and the bytes have to come back identical -- which checks the
 * decoder and the encoder against each other and both of them against V8's
 * output in one comparison. A handful of spot values ride alongside in
 * index.json so that a systematic mis-decode which happens to round-trip still
 * fails.
 *
 * The scenarios deliberately reach the corners: negative coordinates (Math.round
 * is half-up and Swift's .rounded() is not), a colour that repeats and one that
 * does not, an origin that differs from the position, a goal naming no wall, a
 * label with astral-plane text, and every optional block both present and absent.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeScenario } from '../src/state/codec.ts';
import { FIXTURES } from './codecScenarios.ts';

const OUT = resolve(import.meta.dirname, '../../ios/Fixtures/codec');
mkdirSync(OUT, { recursive: true });

const index: Record<string, unknown> = {};
for (const [name, scenario] of Object.entries(FIXTURES)) {
  const bytes = encodeScenario(scenario);
  writeFileSync(resolve(OUT, `${name}.wkcd`), bytes);
  index[name] = {
    bytes: bytes.length,
    walls: scenario.walls.length,
    agents: scenario.agents.length,
    labels: scenario.labels?.length ?? 0,
    generators: scenario.generators?.length ?? 0,
    // Spot values a mis-decode that still round-trips would get wrong.
    speed: scenario.settings.speed,
    zoomLevel: scenario.view.zoomLevel,
    firstWallId: scenario.walls[0]?.id ?? null,
    lastLabelText: scenario.labels?.[scenario.labels.length - 1]?.text ?? null,
  };
  console.log(`${name.padEnd(22)} ${String(bytes.length).padStart(5)} bytes`);
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`\nwrote ${Object.keys(FIXTURES).length} fixtures to ${OUT}`);
