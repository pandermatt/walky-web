/**
 * The sound a pedestrian makes when it reaches its goal.
 *
 * Synthesised rather than sampled: a plop is a sine whose pitch falls by two
 * thirds in under a tenth of a second, which is a handful of scheduled parameter
 * ramps and needs no asset, no decode and no network request. A crowd arriving is
 * hundreds of these at once, so the shaping below is mostly about *not* playing
 * all of them.
 */

/** Peak of a single voice, before the master gain. */
const PEAK = 0.22;
/** Voices a single call may start. Beyond this a crowd is a wall of noise. */
const MAX_VOICES = 4;
/** Seconds between consecutive voices, so plops read as separate drops. */
const SPREAD = 0.035;
/** How far ahead voices may be queued; older backlog is dropped, not delayed. */
const MAX_BACKLOG = 0.25;

const BASE_HZ = 700;
/** Fraction of the starting pitch the drop lands on. */
const DROP = 0.3;
const DECAY = 0.16;
/** Below this an exponential ramp is treated as silence; it cannot reach 0. */
const SILENCE = 0.0001;

/**
 * Plays one short plop per arrival.
 *
 * The audio context is created on first use and kept: browsers start it
 * suspended unless it was created inside a user gesture, so `arm` exists to be
 * called from a click. Everything here degrades to silence -- a browser without
 * Web Audio, a context the page is not allowed to start -- rather than throwing
 * into the simulation loop.
 */
export class Plops {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Set after a failure, so a broken context is not retried every tick. */
  private blocked = false;
  /** When the most recent voice was scheduled, in context time. */
  private lastVoiceAt = 0;

  constructor(private create: () => AudioContext = defaultContext) {}

  /**
   * Start (or resume) the context. Call from a user gesture -- a context created
   * anywhere else begins suspended and every sound scheduled on it is silent.
   */
  arm(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  /**
   * One plop per entry, each panned by its own value in [-1, 1].
   *
   * Only the first few are heard, quieter as their number grows, and they are
   * spread over time from wherever the last batch left off. A hundred pedestrians
   * crossing the line together sound like a scatter of drops rather than one
   * clipped thud.
   */
  play(pans: readonly number[]): void {
    if (pans.length === 0) return;
    const ctx = this.context();
    if (!ctx || !this.master) return;

    const voices = Math.min(pans.length, MAX_VOICES);
    // Loudness by count, not per voice: four plops at full peak would be four
    // times the amplitude of one.
    const gain = PEAK / Math.sqrt(voices);

    const now = ctx.currentTime;
    // A steady trickle of arrivals would otherwise queue faster than it drains,
    // so the backlog is capped and the excess dropped.
    let at = Math.max(now, Math.min(this.lastVoiceAt + SPREAD, now + MAX_BACKLOG));

    for (let i = 0; i < voices; i++) {
      this.voice(at, pans[i], gain);
      this.lastVoiceAt = at;
      at += SPREAD;
    }
  }

  /** Releases the context. Nothing else here needs teardown. */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close();
  }

  private context(): AudioContext | null {
    if (this.ctx || this.blocked) return this.ctx;
    try {
      const ctx = this.create();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    } catch {
      // No Web Audio, or the page may not have one. Stay silent for good.
      this.blocked = true;
    }
    return this.ctx;
  }

  /** A pitch falling fast under a near-instant attack: the plop itself. */
  private voice(at: number, pan: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // A little scatter, so a crowd does not sound like one note repeated.
    const start = BASE_HZ * (0.85 + Math.random() * 0.3);
    osc.frequency.setValueAtTime(start, at);
    osc.frequency.exponentialRampToValueAtTime(start * DROP, at + DECAY * 0.7);

    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENCE, at);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, SILENCE * 2), at + 0.006);
    env.gain.exponentialRampToValueAtTime(SILENCE, at + DECAY);
    osc.connect(env);

    // Panning is a nicety, not a requirement: without StereoPannerNode the plop
    // still plays, just centred.
    let tail: AudioNode = env;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), at);
      env.connect(panner);
      tail = panner;
    }
    tail.connect(master);

    osc.start(at);
    // Stopping is what frees the voice; a stopped node is collected on its own.
    osc.stop(at + DECAY + 0.05);
  }
}

function defaultContext(): AudioContext {
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio unavailable');
  return new Ctor();
}
