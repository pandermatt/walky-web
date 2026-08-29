import { describe, expect, it } from 'vitest';
import { placeTip } from '../ui/tooltip';

/**
 * The placement is a pure function over rectangles precisely so that "the tip
 * ends up on screen" is checkable here rather than only by dragging a window
 * narrow and watching.
 */

const view = { width: 1200, height: 800 };
/** A toolbar cell in the top-left column: 40px, 12px in from both edges. */
const cell = { x: 12, y: 12, width: 40, height: 40 };
const tip = { width: 90, height: 24 };

describe('placeTip', () => {
  it('sits to the right of its anchor, centred on it', () => {
    expect(placeTip(cell, tip, view)).toEqual({ x: 60, y: 20 });
  });

  it('flips to the left when the right side would overrun the viewport', () => {
    const anchor = { x: 1100, y: 400, width: 40, height: 40 };
    // 1148 + 90 is past the 1192 margin, so the tip goes 8px left of the anchor.
    expect(placeTip(anchor, tip, view).x).toBe(1002);
  });

  it('stays on screen where neither side fits', () => {
    const narrow = { width: 100, height: 800 };
    const anchor = { x: 4, y: 400, width: 40, height: 40 };
    const { x } = placeTip(anchor, tip, narrow);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + tip.width).toBeLessThanOrEqual(narrow.width);
  });

  it('clamps a tip against the top and bottom of a short window', () => {
    const short = { width: 1200, height: 200 };
    const tall = { width: 90, height: 120 };
    expect(placeTip({ x: 12, y: 0, width: 40, height: 40 }, tall, short).y).toBe(8);
    expect(placeTip({ x: 12, y: 160, width: 40, height: 40 }, tall, short).y).toBe(72);
  });
});
