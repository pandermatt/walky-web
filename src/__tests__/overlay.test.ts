import { describe, expect, it } from 'vitest';
import { debugTextOrigin, labelBox } from '../render/overlay';

/**
 * The placement is a pure function over rectangles so that "the readout is not
 * hidden behind the toolbar" is checkable here, rather than only by turning
 * Debug info on and squinting at the corner.
 */

/** Five lines of the widest thing debugLines() writes, near enough. */
const LINES = 5;
const TEXT_W = 200;
/** The browser strip: a column of 40px cells, 6px padding, 12px in from both edges. */
const COLUMN = { left: 12, top: 12, right: 64, bottom: 612 };

describe('debugTextOrigin', () => {
  it('keeps the original corner when nothing is in the way', () => {
    expect(debugTextOrigin(LINES, TEXT_W, null)).toEqual([20, 20]);
  });

  it('indents past the browser toolbar, which shares that corner', () => {
    expect(debugTextOrigin(LINES, TEXT_W, COLUMN)).toEqual([76, 20]);
  });

  it('stays in the corner when the bar is across the bottom, as installed', () => {
    const bar = { left: 12, top: 700, right: 800, bottom: 780 };
    expect(debugTextOrigin(LINES, TEXT_W, bar)).toEqual([20, 20]);
  });

  it('stays in the corner when the bar is off to the right of the text', () => {
    const bar = { left: 900, top: 12, right: 952, bottom: 612 };
    expect(debugTextOrigin(LINES, TEXT_W, bar)).toEqual([20, 20]);
  });

  it('leaves a short readout alone once the bar starts below it', () => {
    // One line, so the block is 20px tall; a bar beginning at 300 is past it.
    const bar = { left: 12, top: 300, right: 64, bottom: 612 };
    expect(debugTextOrigin(1, TEXT_W, bar)).toEqual([20, 20]);
    // The same bar does overlap a readout long enough to reach it.
    expect(debugTextOrigin(20, TEXT_W, bar)).toEqual([76, 20]);
  });

  it('has nothing to place when there are no lines', () => {
    expect(debugTextOrigin(0, 0, COLUMN)).toEqual([20, 20]);
  });
});

/**
 * The other half of pointing at a label: the eraser has to know where a word is
 * before it can offer to rub it out, and the anchor is not the corner of it.
 */
describe('the box a label fills', () => {
  it('runs forward from the anchor and sits centred on it', () => {
    // Drawn textAlign start, textBaseline middle: rightwards from the anchor,
    // half its height either side.
    expect(labelBox([100, 50], 80, 28)).toEqual({
      minX: 100, minY: 36, maxX: 180, maxY: 64,
    });
  });

  it('grows by the clearance an outline is drawn with', () => {
    expect(labelBox([0, 0], 40, 20, 4)).toEqual({
      minX: -4, minY: -14, maxX: 44, maxY: 14,
    });
  });

  it('is still a box when the word is empty, so a caret can be pointed at', () => {
    const box = labelBox([10, 10], 0, 30);
    expect(box.maxX).toBe(10);
    expect(box.maxY - box.minY).toBe(30);
  });
});
