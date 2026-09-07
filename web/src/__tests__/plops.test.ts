import { describe, it, expect } from 'vitest';
import { Plops } from '../audio/plops';

/**
 * A stand-in for the browser's audio graph. It records what was started rather
 * than making a sound, so the scheduling rules -- how many voices a crowd gets,
 * and when -- can be asserted in Node.
 */
class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = { kind: 'destination' } as unknown as AudioDestinationNode;
  starts: number[] = [];
  pans: number[] = [];
  resumed = 0;

  resume(): Promise<void> { this.state = 'running'; this.resumed++; return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }

  createGain(): GainNode {
    return {
      gain: param(),
      connect() {}, disconnect() {},
    } as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    const record = (v: number) => { this.pans.push(v); };
    return {
      pan: { setValueAtTime(v: number) { record(v); }, value: 0 },
      connect() {}, disconnect() {},
    } as unknown as StereoPannerNode;
  }

  createOscillator(): OscillatorNode {
    const starts = this.starts;
    return {
      type: 'sine',
      frequency: param(),
      connect() {}, disconnect() {},
      start(at: number) { starts.push(at); },
      stop() {},
    } as unknown as OscillatorNode;
  }
}

function param() {
  return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
}

function plops(): { player: Plops; ctx: FakeContext } {
  const ctx = new FakeContext();
  return { player: new Plops(() => ctx as unknown as AudioContext), ctx };
}

describe('arrival plops', () => {
  it('plays one voice per arrival', () => {
    const { player, ctx } = plops();
    player.play([0]);
    player.play([0]);
    expect(ctx.starts.length).toBe(2);
  });

  it('caps a crowd arriving at once instead of stacking hundreds of voices', () => {
    const { player, ctx } = plops();
    player.play(new Array(500).fill(0));
    expect(ctx.starts.length).toBeLessThanOrEqual(4);
    expect(ctx.starts.length).toBeGreaterThan(0);
  });

  it('spreads simultaneous voices in time, so they read as separate drops', () => {
    const { player, ctx } = plops();
    player.play([0, 0, 0, 0]);
    for (let i = 1; i < ctx.starts.length; i++) {
      expect(ctx.starts[i]).toBeGreaterThan(ctx.starts[i - 1]);
    }
  });

  it('does not queue further and further ahead under a steady stream', () => {
    // A trickle of arrivals every tick would otherwise schedule faster than it
    // drains, and the sound would drift seconds behind the picture.
    const { player, ctx } = plops();
    for (let tick = 0; tick < 600; tick++) {
      player.play([0]);
      ctx.currentTime += 1 / 60;
    }
    const last = ctx.starts[ctx.starts.length - 1];
    expect(last - ctx.currentTime).toBeLessThanOrEqual(0.25);
  });

  it('pans by where the arrival happened, clamped to the stereo field', () => {
    const { player, ctx } = plops();
    player.play([-4, 4]);
    expect(ctx.pans).toEqual([-1, 1]);
  });

  it('does nothing when nobody arrived', () => {
    const { player, ctx } = plops();
    player.play([]);
    expect(ctx.starts.length).toBe(0);
  });

  it('stays silent, rather than throwing, without Web Audio', () => {
    const player = new Plops(() => { throw new Error('no Web Audio'); });
    expect(() => player.play([0])).not.toThrow();
    expect(() => player.arm()).not.toThrow();
  });

  it('resumes a suspended context when armed from a gesture', () => {
    const { player, ctx } = plops();
    player.arm();
    expect(ctx.resumed).toBe(1);
    player.arm();
    expect(ctx.resumed).toBe(1); // already running
  });
});
