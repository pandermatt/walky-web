import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// These replay hundreds of pedestrians for hundreds of ticks apiece.
vi.setConfig({ testTimeout: 60_000 });

import { decodeTrace, packTick, fnv1a64, CHECKPOINT_EVERY } from '../../tools/traceFormat.ts';
import { SCENARIOS, buildScenario, R } from '../../tools/traceScenarios.ts';

/**
 * The ratchet.
 *
 * `ios/Fixtures/*.wktr` is what the Swift port is checked against, so a change
 * to behaviour.ts that moves the crowd must fail *here* -- in the suite that
 * runs on every commit -- rather than silently leaving the two implementations
 * describing different simulations. When one of these fails, the fix is to look
 * at whether the change was intended and then regenerate:
 *
 *     npx vite-node tools/goldenTrace.ts
 *
 * ...and port the same change to Swift in the same commit. That coupling is the
 * whole point; without it the port rots the first time somebody tunes a weight.
 *
 * This is also a second, independent statement of the determinism invariant:
 * determinism.test.ts proves a run reproduces *within one process*, and these
 * prove it reproduces across processes and across time.
 */

const FIXTURES = resolve(import.meta.dirname, '../../ios/Fixtures');

describe('golden traces still reproduce', () => {
  for (const spec of SCENARIOS) {
    it(`${spec.name} — ${spec.proves}`, () => {
      const path = resolve(FIXTURES, `${spec.name}.wktr`);
      expect(existsSync(path), `missing fixture: run npx vite-node tools/goldenTrace.ts`).toBe(true);

      const want = decodeTrace(new Uint8Array(readFileSync(path)));
      expect(want.radius).toBe(R);
      expect(want.speed).toBe(spec.speed);
      expect(want.personalSpace).toBe(spec.personalSpace);
      expect(want.checksums.length).toBe(spec.ticks);

      const { walls, agents, step } = buildScenario(spec);
      const wallIds = walls.map((w) => w.id);
      expect(agents.count).toBe(want.agentCount);

      const scratch = new Uint8Array(agents.count * 33 + 33 * 64);
      const checkpoints = new Map(want.checkpoints.map((c) => [c.tick, c]));

      for (let t = 0; t < spec.ticks; t++) {
        step();
        const packed = packTick(agents, wallIds, scratch);

        if (fnv1a64(packed) !== want.checksums[t]) {
          // Report the tick, and -- if this one is a checkpoint -- the first
          // field that actually differs. A bare "checksums differ" would send
          // somebody hunting through 900 ticks by hand.
          const cp = checkpoints.get(t);
          let detail = '';
          if (cp) {
            for (let b = 0; b < packed.length; b++) {
              if (packed[b] !== cp.bytes[b]) {
                detail = `; first differing byte ${b} (agent ${Math.floor(b / 33)}, offset ${b % 33})`;
                break;
              }
            }
          }
          throw new Error(
            `${spec.name} diverged at tick ${t} of ${spec.ticks}${detail}\n` +
            `  The model changed. If that was intended, regenerate the fixtures\n` +
            `  (npx vite-node tools/goldenTrace.ts) and port the same change to\n` +
            `  ios/Sources/WalkySim in the same commit.`,
          );
        }
      }
    });
  }

  it('records full state at checkpoints, so a divergence has something to diff against', () => {
    const path = resolve(FIXTURES, 'corridor-40.wktr');
    const trace = decodeTrace(new Uint8Array(readFileSync(path)));
    expect(trace.checkpointEvery).toBe(CHECKPOINT_EVERY);
    // Tick 0 above all: a port that is wrong on its very first step is the
    // common case while it is young, and that is where it lands.
    expect(trace.checkpoints[0].tick).toBe(0);
    // The last tick is checkpointed whether or not it falls on the stride, so
    // a divergence in the closing ticks still has full state beside it.
    expect(trace.checkpoints.at(-1)!.tick).toBe(899);
    const onStride = Math.ceil(900 / CHECKPOINT_EVERY);
    expect(trace.checkpoints.length).toBe(onStride + (899 % CHECKPOINT_EVERY === 0 ? 0 : 1));
    expect(trace.checkpoints.map((c) => c.tick).slice(0, 3)).toEqual([0, 25, 50]);
    for (const c of trace.checkpoints) expect(c.count).toBe(trace.agentCount);
  });
});
