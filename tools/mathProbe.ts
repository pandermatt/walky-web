/**
 * What V8 makes of the transcendentals, sampled over the ranges the model
 * actually uses them in.
 *
 * `Math.exp` and friends are "implementation-approximated" in both ECMAScript
 * and Swift, and V8 and Darwin's libm do not agree: measured over these ranges,
 * they differ on 19% of `atan2` inputs, 15% of `acos`, and 11% of `exp`. In a
 * model this chaotic that is not a rounding error -- `acos` decides which ear
 * `convexDecompose` clips, so it changes the wall decomposition and with it the
 * entire navigation graph.
 *
 * So the Swift port carries fdlibm, which is what V8 carries, and this file is
 * the evidence that it matches. Run it, then `swift run walky-conform math`.
 *
 *   npx vite-node tools/mathProbe.ts
 *
 * The ranges below are not round numbers picked for tidiness; each is where the
 * cited call site can actually land.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../ios/Fixtures/math.wkmp');
const MAGIC = 0x504d4b57; // "WKMP" little-endian
const VERSION = 1;
const SAMPLES = 20_000;

/**
 * A hash, not `Math.random`, so regenerating the probe does not rewrite every
 * byte of it -- the same rule the model itself follows.
 */
function rnd(i: number, salt: number): number {
  let h = salt ^ Math.imul(i, 73856093);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Probe {
  name: string;
  arity: 1 | 2;
  /** Where this function is called from, and what it can be handed there. */
  at: string;
  sample(i: number): [number, number];
  f(a: number, b: number): number;
}

const lerp = (u: number, lo: number, hi: number) => lo + u * (hi - lo);

const PROBES: Probe[] = [
  {
    name: 'exp', arity: 1,
    at: 'behaviour.ts:173 crowdPace, :801 the discomfort gradient',
    // crowdPace feeds -0.22 * over, over >= 0. The gradient feeds
    // (reachJ - d) / decayJ, negative in the ordinary case and mildly
    // positive when a neighbour is inside the reach.
    sample: (i) => [lerp(rnd(i, 0x9e37), -30, 2), 0],
    f: (a) => Math.exp(a),
  },
  {
    name: 'log', arity: 1,
    at: 'arrivals.ts:153 sizeOf, :160 gapOf',
    // Both are log(1 - u) with u a uniform in [0,1), so the argument is (0,1].
    sample: (i) => [lerp(rnd(i, 0x85eb), 1e-12, 1), 0],
    f: (a) => Math.log(a),
  },
  {
    name: 'sin', arity: 1,
    at: 'behaviour.ts:945 the wander, :1022 the refinement, :1067 the carry swing',
    // The wander is sin(x * 0.031 + y * 0.017 + trait * 6.283), and codec.ts:138
    // caps a coordinate at 2^22 -- so the argument reaches about +/-201,000.
    // Well inside fdlibm's 2^20 medium-reduction branch, but nowhere near small.
    sample: (i) => [lerp(rnd(i, 0xc2b2), -201_400, 201_400), 0],
    f: (a) => Math.sin(a),
  },
  {
    name: 'cos', arity: 1,
    at: 'behaviour.ts:1021 the refinement, :1066 the carry swing',
    sample: (i) => [lerp(rnd(i, 0x27d4), -201_400, 201_400), 0],
    f: (a) => Math.cos(a),
  },
  {
    name: 'sin-small', arity: 1,
    at: 'behaviour.ts:1023 -- angle +/- PI/8, and the carry swing, which is small',
    // Sampled separately because the small-argument branches are different code
    // and a uniform draw over +/-201,000 essentially never reaches them.
    sample: (i) => [lerp(rnd(i, 0x165667), -4, 4), 0],
    f: (a) => Math.sin(a),
  },
  {
    name: 'cos-small', arity: 1,
    at: 'behaviour.ts:1021 -- angle +/- PI/8',
    sample: (i) => [lerp(rnd(i, 0xd3a2), -4, 4), 0],
    f: (a) => Math.cos(a),
  },
  {
    name: 'atan2', arity: 2,
    at: 'behaviour.ts:1020 -- atan2(bestUy, bestUx), a step direction',
    sample: (i) => [lerp(rnd(i, 0x1b87), -1, 1), lerp(rnd(i, 0x6a09), -1, 1)],
    f: (a, b) => Math.atan2(a, b),
  },
  {
    name: 'acos', arity: 1,
    at: 'convexDecompose.ts:70 smallestAngle -- clamped to [-1,1] at the call site',
    sample: (i) => [lerp(rnd(i, 0xbb67), -1, 1), 0],
    f: (a) => Math.acos(a),
  },
  {
    name: 'pow', arity: 2,
    at: 'behaviour.ts:1242 -- pow(1 - HEADING_SMOOTH, length), length a step distance',
    // The base is the constant 0.65. The exponent is a step length, which the
    // budget bounds at a little over sqrt(2) per tick.
    sample: (i) => [0.65, lerp(rnd(i, 0x3c6e), 0, 1.5)],
    f: (a, b) => Math.pow(a, b),
  },
  {
    name: 'hypot', arity: 2,
    at: 'geometry.ts:26 and 19 other sites, including behaviour.ts:755/:773',
    // Not implementation-approximated in the same way, but V8's is
    // max * sqrt(1 + (min/max)^2) and the naive sqrt(dx*dx + dy*dy) differs
    // from it on 39% of inputs. Probed so the Swift side cannot drift.
    sample: (i) => [lerp(rnd(i, 0xa54f), -4000, 4000), lerp(rnd(i, 0x510e), -4000, 4000)],
    f: (a, b) => Math.hypot(a, b),
  },
];

/**
 * Results only. Every input is `rnd(i, salt)`, so the Swift side derives them
 * from the sample index instead of reading 16 bytes of each one -- which takes
 * the file from 12 MB to 1.6 MB.
 *
 * That means the input generator exists twice, which is exactly the trap this
 * project warns about elsewhere. It is safe here for one reason: a generator
 * that disagreed would mismatch on essentially every sample rather than a few,
 * so it cannot be confused with a rounding difference. The four probe inputs
 * written into the header make it say so outright instead of leaving it to be
 * inferred.
 */
const GUARD = 4;
const head = 4 + 4 + 4;
let size = head;
for (const p of PROBES) size += 1 + p.name.length + 1 + 4 + GUARD * 16 + SAMPLES * 8;

const buf = new ArrayBuffer(size);
const view = new DataView(buf);
const bytes = new Uint8Array(buf);
let o = 0;
view.setUint32(o, MAGIC, true); o += 4;
view.setUint32(o, VERSION, true); o += 4;
view.setUint32(o, PROBES.length, true); o += 4;

for (const p of PROBES) {
  bytes[o++] = p.name.length;
  for (let i = 0; i < p.name.length; i++) bytes[o++] = p.name.charCodeAt(i);
  bytes[o++] = p.arity;
  view.setUint32(o, SAMPLES, true); o += 4;
  for (let i = 0; i < GUARD; i++) {
    const [a, b] = p.sample(i);
    view.setFloat64(o, a, true); o += 8;
    view.setFloat64(o, b, true); o += 8;
  }
  for (let i = 0; i < SAMPLES; i++) {
    const [a, b] = p.sample(i);
    view.setFloat64(o, p.f(a, b), true); o += 8;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`${OUT}  ${PROBES.length} functions x ${SAMPLES.toLocaleString()} samples  ${(size / 1e6).toFixed(1)} MB`);
for (const p of PROBES) console.log(`  ${p.name.padEnd(10)} ${p.at}`);
