/**
 * The `.wktr` wire format: one recorded run, checksummed tick by tick.
 *
 * Binary rather than JSON, for one reason. A decimal round-trip hides exactly
 * the last-bit differences this whole exercise is hunting -- a fixture written
 * as text would agree with a Swift port that was subtly wrong, which is worse
 * than having no fixture at all. Float32 bit patterns go out as float32 and
 * come back as float32.
 *
 * ## Why checksums rather than every record
 *
 * Recording all 900 ticks of the counterflow run in full costs 3.2 MB, and the
 * whole set costs 15 MB. That is affordable once and unaffordable as a habit:
 * these fixtures are regenerated whenever behaviour.ts changes, and each
 * regeneration would add another 15 MB to git history for good.
 *
 * A 64-bit checksum per tick localises a divergence to the exact tick just as
 * well as the full records do -- which is the thing actually needed, because a
 * run that matches for 400 ticks and then splits is a findable bug, while one
 * that "matches to 1e-6" is nothing. Full records are kept at checkpoints so
 * there is real state to diagnose against near wherever the split happened.
 * The set comes to about 700 KB.
 *
 * When a divergence does need field-level detail at an arbitrary tick,
 * `goldenTrace.ts --full <name>` rewrites that one scenario with every record,
 * into a file git ignores.
 *
 * Each record carries heading, stalled and pressure alongside position. They
 * are the state that *causes* the next tick's decision, so a mismatch shows up
 * on the tick it happened rather than the tick it first moved somebody
 * visibly -- often hundreds of ticks apart.
 *
 * Colour is deliberately absent: it is the one field the model draws randomly
 * (palette.ts:28), and nothing depends on it.
 *
 * A record's `goal` is an *index into the scenario's wall list*, not a wall id.
 * Ids come from a module-level counter in model.ts, so they depend on how many
 * walls the process happened to make first: adding a scenario at the top of the
 * generator would otherwise rewrite every fixture below it for no modelling
 * reason, and a test that rebuilds one scenario alone could never reproduce
 * one. The index is a property of the map; the id is a property of the run.
 */

export const TRACE_MAGIC = 0x5254_4b57; // "WKTR" little-endian
export const TRACE_VERSION = 2;

/** float32 x, y, headingX, headingY; int32 goal; uint8 arrived; int32 party; float32 stalled, pressure. */
export const RECORD_BYTES = 33;

/** Full records this often. 25 keeps the set under a megabyte. */
export const CHECKPOINT_EVERY = 25;

export interface TickSource {
  count: number;
  x: Float32Array; y: Float32Array;
  headingX: Float32Array; headingY: Float32Array;
  goal: Int32Array;
  arrived: Uint8Array;
  party: Int32Array;
  stalled: Float32Array;
  pressure: Float32Array;
}

/**
 * FNV-1a, so a truncated or corrupted fixture says so rather than mis-comparing.
 *
 * The 64-bit offset basis and prime, spelled out: an earlier draft used
 * 0x10000193 here, which is neither the 32-bit constant nor the 64-bit one, and
 * would have disagreed with the Swift reader for reasons that look exactly like
 * a divergence in the model.
 */
export function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf2_9ce4_8422_2325n;
  const prime = 0x0000_0100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (let i = 0; i < bytes.length; i++) h = (h ^ BigInt(bytes[i])) * prime & mask;
  return h;
}

/**
 * One tick's records, laid out exactly as the checksum sees them.
 *
 * The layout is the contract: the Swift port hashes the same bytes in the same
 * order, so this function and its Swift twin are the only place the two
 * implementations have to agree about *encoding* rather than about the model.
 */
export function packTick(a: TickSource, wallIds: readonly number[], into: Uint8Array): Uint8Array {
  const view = new DataView(into.buffer, into.byteOffset, into.byteLength);
  let o = 0;
  for (let i = 0; i < a.count; i++) {
    const goalIndex = wallIds.indexOf(a.goal[i]);
    view.setFloat32(o, a.x[i], true); o += 4;
    view.setFloat32(o, a.y[i], true); o += 4;
    view.setFloat32(o, a.headingX[i], true); o += 4;
    view.setFloat32(o, a.headingY[i], true); o += 4;
    view.setInt32(o, goalIndex, true); o += 4;
    into[o] = a.arrived[i]; o += 1;
    view.setInt32(o, a.party[i], true); o += 4;
    view.setFloat32(o, a.stalled[i], true); o += 4;
    view.setFloat32(o, a.pressure[i], true); o += 4;
  }
  return into.subarray(0, o);
}

export interface EncodeOptions {
  /** Every tick becomes a checkpoint. For `--full`, which git ignores. */
  full?: boolean;
}

export function encodeTrace(
  name: string,
  radius: number, speed: number, personalSpace: number,
  ticks: number,
  agents: TickSource,
  /** The scenario's walls in order; a record's goal is an index into this. */
  wallIds: readonly number[],
  step: () => void,
  options: EncodeOptions = {},
): Uint8Array {
  const every = options.full ? 1 : CHECKPOINT_EVERY;
  const nameBytes = new TextEncoder().encode(name);

  const checksums: bigint[] = [];
  const checkpoints: { tick: number; bytes: Uint8Array }[] = [];
  const scratch = new Uint8Array(Math.max(1, agents.count) * RECORD_BYTES + RECORD_BYTES * 64);

  for (let t = 0; t < ticks; t++) {
    step();
    const packed = packTick(agents, wallIds, scratch);
    checksums.push(fnv1a64(packed));
    // Tick 0 is always a checkpoint: it is where a divergence in the very first
    // step lands, and that is the most common kind while a port is young.
    if (t % every === 0 || t === ticks - 1) {
      checkpoints.push({ tick: t, bytes: packed.slice() });
    }
  }

  let size = 4 + 4 + 2 + nameBytes.length + 8 * 3 + 4 + 4 + 4 + ticks * 8 + 4;
  for (const c of checkpoints) size += 4 + 4 + c.bytes.length;
  size += 8;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  view.setUint32(o, TRACE_MAGIC, true); o += 4;
  view.setUint32(o, TRACE_VERSION, true); o += 4;
  view.setUint16(o, nameBytes.length, true); o += 2;
  bytes.set(nameBytes, o); o += nameBytes.length;
  view.setFloat64(o, radius, true); o += 8;
  view.setFloat64(o, speed, true); o += 8;
  view.setFloat64(o, personalSpace, true); o += 8;
  view.setUint32(o, ticks, true); o += 4;
  view.setUint32(o, every, true); o += 4;
  view.setUint32(o, agents.count, true); o += 4;

  const start = o;
  for (const c of checksums) { view.setBigUint64(o, c, true); o += 8; }
  view.setUint32(o, checkpoints.length, true); o += 4;
  for (const c of checkpoints) {
    view.setUint32(o, c.tick, true); o += 4;
    view.setUint32(o, c.bytes.length / RECORD_BYTES, true); o += 4;
    bytes.set(c.bytes, o); o += c.bytes.length;
  }
  view.setBigUint64(o, fnv1a64(bytes.subarray(start, o)), true); o += 8;
  return bytes.subarray(0, o);
}

export interface Trace {
  name: string;
  radius: number;
  speed: number;
  personalSpace: number;
  checksums: bigint[];
  checkpointEvery: number;
  agentCount: number;
  checkpoints: { tick: number; count: number; bytes: Uint8Array }[];
}

/** Reads a fixture back, for the ratchet test. */
export function decodeTrace(bytes: Uint8Array): Trace {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  if (view.getUint32(o, true) !== TRACE_MAGIC) throw new Error('not a .wktr file');
  o += 4;
  const version = view.getUint32(o, true); o += 4;
  if (version !== TRACE_VERSION) throw new Error(`.wktr version ${version}, expected ${TRACE_VERSION}`);
  const nameLen = view.getUint16(o, true); o += 2;
  const name = new TextDecoder().decode(bytes.subarray(o, o + nameLen)); o += nameLen;
  const radius = view.getFloat64(o, true); o += 8;
  const speed = view.getFloat64(o, true); o += 8;
  const personalSpace = view.getFloat64(o, true); o += 8;
  const tickCount = view.getUint32(o, true); o += 4;
  const checkpointEvery = view.getUint32(o, true); o += 4;
  const agentCount = view.getUint32(o, true); o += 4;

  const start = o;
  const checksums: bigint[] = [];
  for (let t = 0; t < tickCount; t++) { checksums.push(view.getBigUint64(o, true)); o += 8; }
  const cpCount = view.getUint32(o, true); o += 4;
  const checkpoints: { tick: number; count: number; bytes: Uint8Array }[] = [];
  for (let i = 0; i < cpCount; i++) {
    const tick = view.getUint32(o, true); o += 4;
    const count = view.getUint32(o, true); o += 4;
    checkpoints.push({ tick, count, bytes: bytes.subarray(o, o + count * RECORD_BYTES) });
    o += count * RECORD_BYTES;
  }
  if (view.getBigUint64(o, true) !== fnv1a64(bytes.subarray(start, o))) {
    throw new Error('.wktr checksum mismatch: file is corrupt or truncated');
  }
  return { name, radius, speed, personalSpace, checksums, checkpointEvery, agentCount, checkpoints };
}
