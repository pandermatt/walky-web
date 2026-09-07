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
/** A laptop window, in CSS pixels. */
const VIEW = { width: 1000, height: 800 };
/** The browser strip: a column of 40px cells, 6px padding, 12px in from both edges. */
const COLUMN = { left: 12, top: 12, right: 64, bottom: 788 };
/** The baseline of the first of five lines, sitting 20px off the bottom edge. */
const FIRST = VIEW.height - 20 - (LINES - 1) * 20;

describe('debugTextOrigin', () => {
  it('sits in the bottom-left corner when nothing is in the way', () => {
    expect(debugTextOrigin(LINES, TEXT_W, null, VIEW)).toEqual([20, FIRST]);
  });

  it('indents past the browser toolbar, whose column reaches that corner', () => {
    expect(debugTextOrigin(LINES, TEXT_W, COLUMN, VIEW)).toEqual([76, FIRST]);
  });

  it('stays in the corner when the column stops short of the readout', () => {
    // A column of a few buttons on a tall window: nowhere near the bottom.
    const bar = { left: 12, top: 12, right: 64, bottom: 300 };
    expect(debugTextOrigin(LINES, TEXT_W, bar, VIEW)).toEqual([20, FIRST]);
  });

  it('stays in the corner when the bar is off to the right of the text', () => {
    const bar = { left: 900, top: 12, right: 952, bottom: 788 };
    expect(debugTextOrigin(LINES, TEXT_W, bar, VIEW)).toEqual([20, FIRST]);
  });

  it('lifts above a full-width bar, as the strip is when installed', () => {
    // Nothing to the right of it to step into, so the block goes above instead:
    // the last baseline 12px over the bar, the rest stacked up from there.
    const bar = { left: 12, top: 700, right: 988, bottom: 780 };
    expect(debugTextOrigin(LINES, TEXT_W, bar, VIEW)).toEqual([20, 688 - (LINES - 1) * 20]);
  });

  it('has nothing to place when there are no lines', () => {
    expect(debugTextOrigin(0, 0, COLUMN, VIEW)).toEqual([20, VIEW.height - 20]);
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
