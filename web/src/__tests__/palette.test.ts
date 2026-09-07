import { describe, it, expect } from 'vitest';
import {
  javaDarker, shadowOf, randomBrightColor, BACKGROUND, toHex, withAlpha, relativeLuminance,
  type RGB,
} from '../palette';

describe('javaDarker', () => {
  it('matches Java Color.darker() truncation on the brief\'s real examples', () => {
    expect(javaDarker([196, 25, 192])).toEqual([137, 17, 134]);
    expect(javaDarker([18, 253, 222])).toEqual([12, 177, 155]);
  });

  it('produces the documented shadow colours when applied twice', () => {
    expect(toHex(shadowOf([0xc4, 0x19, 0xc0]))).toBe('#5F0B5D');
    expect(toHex(shadowOf([0x12, 0xfd, 0xde]))).toBe('#087B6C');
  });

  it('never goes below zero and is idempotent at zero', () => {
    expect(javaDarker([0, 0, 0])).toEqual([0, 0, 0]);
    expect(javaDarker([1, 2, 3])).toEqual([0, 1, 2]);
  });
});

describe('BACKGROUND', () => {
  it('is DARK_GRAY darkened twice, i.e. #1E1E1E and not #1F1F1F', () => {
    expect(BACKGROUND).toEqual([30, 30, 30]);
    expect(toHex(BACKGROUND)).toBe('#1E1E1E');
  });
});

describe('randomBrightColor', () => {
  it('always leaves at least one channel at 150 or above', () => {
    for (let i = 0; i < 10_000; i++) {
      const c = randomBrightColor();
      expect(Math.max(...c)).toBeGreaterThanOrEqual(150);
    }
  });

  it('stays inside 0-255 on every channel', () => {
    for (let i = 0; i < 10_000; i++) {
      for (const v of randomBrightColor()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('reaches 150 exactly, as the code allows even though the javadoc says > 150', () => {
    // 150 is reachable; over 200k samples it should show up on the forced channel.
    let saw150 = false;
    for (let i = 0; i < 200_000 && !saw150; i++) {
      const c: RGB = randomBrightColor();
      if (c.includes(150)) saw150 = true;
    }
    expect(saw150).toBe(true);
  });

  it('uses all three channels as the bright one', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const c = randomBrightColor();
      c.forEach((v, idx) => { if (v >= 150) seen.add(idx); });
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });
});

describe('withAlpha', () => {
  it('keeps the channels and adds the alpha', () => {
    expect(withAlpha([255, 200, 0], 0.28)).toBe('rgba(255,200,0,0.28)');
  });
});

describe('relativeLuminance', () => {
  it('runs from black to white', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
  });
});
