import { describe, expect, it } from 'vitest';
import {
  canRecord, captureSize, cropSource, fitRect, formatElapsed, pickMimeType, recordingFilename,
} from '../render/recorder';

/**
 * The recorder's browser half needs a browser; everything it decides before it
 * touches one does not. The container it picks, the size it captures at, where a
 * resized window lands in a frame that cannot change shape, and what the file is
 * called are all answerable here, which is where the awkward cases live.
 */

/** A browser that accepts exactly the listed types and nothing else. */
const accepts = (...types: string[]) => (type: string) => types.includes(type);

describe('the container', () => {
  it('is mp4 where there is a choice, since a webm is a file half the world cannot open', () => {
    expect(pickMimeType(false, () => true)).toBe('video/mp4;codecs=avc1.42E01E');
  });

  it('is the bare mp4 type for a browser that will not parse a profile string', () => {
    expect(pickMimeType(false, accepts('video/mp4', 'video/webm'))).toBe('video/mp4');
  });

  it('falls back to vp9 where there is no mp4 at all', () => {
    expect(pickMimeType(false, accepts('video/webm;codecs=vp9', 'video/webm')))
      .toBe('video/webm;codecs=vp9');
  });

  it('is nothing at all rather than a guess', () => {
    expect(pickMimeType(false, () => false)).toBeNull();
  });

  it('names an audio codec when the plops are going in, in the same order', () => {
    expect(pickMimeType(true, () => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(pickMimeType(true, accepts('video/webm;codecs=vp9,opus', 'video/webm')))
      .toBe('video/webm;codecs=vp9,opus');
  });

  it('does not offer a sound track a silent recording as its best match', () => {
    // The picture-only list must never name a codec for a track that is not there.
    expect(pickMimeType(false, () => true)).not.toContain('mp4a');
    expect(pickMimeType(false, accepts('video/webm;codecs=vp9'))).not.toContain('opus');
  });
});

describe('canRecord', () => {
  it('answers no outside a browser instead of throwing on a global that is not there', () => {
    expect(() => canRecord()).not.toThrow();
    expect(canRecord()).toBe(false);
  });
});

describe('the capture size', () => {
  it('leaves a 1080p window exactly as it is', () => {
    expect(captureSize(1920, 1080)).toEqual({ w: 1920, h: 1080 });
  });

  it('brings a phone held upright under the cap, which its long side would not have', () => {
    // 1170x2532 is a 390pt window at three device pixels per point: 2.96
    // megapixels, more than 1080p, on a screen nobody would call large.
    const size = captureSize(1170, 2532);
    expect(size.w * size.h).toBeLessThanOrEqual(1920 * 1080);
    expect(size.w / size.h).toBeCloseTo(1170 / 2532, 2);
  });

  it('is even on both axes, which is what H.264 requires', () => {
    for (const [w, h] of [[1170, 2532], [1001, 777], [1365, 683], [3, 5]]) {
      const size = captureSize(w, h);
      expect(size.w % 2).toBe(0);
      expect(size.h % 2).toBe(0);
    }
  });

  it('never comes out at nothing', () => {
    expect(captureSize(1, 1)).toEqual({ w: 2, h: 2 });
  });
});

describe('fitting a resized window into a frame that cannot change shape', () => {
  it('fills a frame of its own proportions exactly', () => {
    expect(fitRect(1920, 1080, 960, 540)).toEqual({ x: 0, y: 0, w: 960, h: 540 });
  });

  it('letterboxes a wider window, leaving the background above and below', () => {
    const box = fitRect(1600, 900, 800, 600);
    expect(box.x).toBe(0);
    expect(box.w).toBe(800);
    expect(box.y).toBeCloseTo(75, 5);
    expect(box.h).toBeCloseTo(450, 5);
  });

  it('pillarboxes a narrower one', () => {
    const box = fitRect(600, 600, 800, 600);
    expect(box.y).toBe(0);
    expect(box.h).toBe(600);
    expect(box.x).toBeCloseTo(100, 5);
  });

  it('never puts a pixel outside the frame', () => {
    for (const [w, h] of [[3000, 100], [100, 3000], [1234, 987]]) {
      const box = fitRect(w, h, 1920, 1080);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1920 + 1e-9);
      expect(box.y + box.h).toBeLessThanOrEqual(1080 + 1e-9);
    }
  });
});

describe('the framed region, in one canvas\'s own pixels', () => {
  /** A retina window: 800x450 CSS, and the buffers the two canvases end up with. */
  const CROP = { x: 100, y: 50, w: 400, h: 200 };

  it('scales a crop by the buffer this canvas actually has', () => {
    expect(cropSource(CROP, 1600, 900, 800, 450)).toEqual({ sx: 200, sy: 100, sw: 800, sh: 400 });
  });

  it('gives each canvas its own answer where their buffers disagree', () => {
    // deck floors css*dpr and the overlay rounds it, so at an odd CSS width the
    // two differ by a pixel. Sharing one source rectangle would slide the
    // overlay off the picture underneath it.
    const deck = cropSource(CROP, 1125, 900, 750.5, 450);
    const overlay = cropSource(CROP, 1126, 900, 750.5, 450);
    expect(deck.sw).not.toBe(overlay.sw);
    expect(overlay.sw / overlay.sh).toBeCloseTo(deck.sw / deck.sh, 2);
  });

  it('clamps a frame the window has since been shrunk past', () => {
    const box = cropSource({ x: 600, y: 300, w: 400, h: 200 }, 800, 400, 800, 400);
    expect(box).toEqual({ sx: 600, sy: 300, sw: 200, sh: 100 });
  });

  it('comes back empty rather than negative when the frame is off the edge', () => {
    const box = cropSource({ x: 900, y: 500, w: 400, h: 200 }, 800, 400, 800, 400);
    expect(box.sw).toBe(0);
    expect(box.sh).toBe(0);
  });

  it('has nothing to crop into a canvas with no size yet', () => {
    expect(cropSource(CROP, 0, 0, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('the readout', () => {
  it('counts in minutes and seconds, padded, across the boundary', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_000)).toBe('0:07');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(64_000)).toBe('1:04');
  });

  it('does not count backwards', () => {
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('the filename', () => {
  const at = new Date(2016, 4, 13, 14, 23, 17);

  it('takes its extension from the container that was actually written', () => {
    expect(recordingFilename('video/mp4;codecs=avc1.42E01E', at)).toBe('walky-2016-05-13-142317.mp4');
    expect(recordingFilename('video/webm;codecs=vp9', at)).toBe('walky-2016-05-13-142317.webm');
  });
});
