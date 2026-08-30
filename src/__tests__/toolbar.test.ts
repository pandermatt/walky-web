import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../ui/toolbar';

/**
 * The shortcuts are derived from the strip, so what is worth checking is the
 * promise the numbers make: the digits are the tools, in the order you see them.
 * Insert a tool without renumbering and this is what says so.
 *
 * The order is by subject -- the geometry, then the people and where they are
 * going, then the two tools that act on what is already down, then the label
 * that is for the reader rather than the simulation. The eraser, the text tool
 * and the generator used to be appended past the end of that for the sake of
 * not renumbering anybody, which is the thing this list stopped promising.
 *
 * Pan is tenth and on 0 because it sits in the view capsule, below the tools,
 * beside the reset that undoes it: the digit counts down the whole strip and not
 * down one capsule. Ten is where a row of digits runs out and 0 is the key that
 * follows 9 along it, so an eleventh tool has nowhere to go -- a fact about the
 * keyboard rather than a rule of ours.
 *
 * Four of these have no cell on a touch device -- the generator, the text tool,
 * the eraser and Pan, which a pinch does better -- and all four keep their
 * numbers anyway. The app is what refuses to arm them (see App.setTool), not the
 * list of keys.
 */

const TOOLS_IN_ORDER = [
  'wall', 'rectangle', 'border', 'pedestrian', 'generator', 'goal', 'select', 'erase', 'text',
  'shift',
];

/** The digit a tool sits on: its place down the strip, with the tenth on 0. */
const digit = (index: number) => String((index + 1) % 10);

describe('the keyboard shortcuts', () => {
  it('number the tools down the strip', () => {
    TOOLS_IN_ORDER.forEach((id, i) => {
      expect(SHORTCUTS.get(digit(i))).toEqual({ key: id, kind: 'tool' });
    });
  });

  it('put start and pause on the space bar', () => {
    expect(SHORTCUTS.get(' ')).toEqual({ key: 'start', kind: 'action' });
  });

  it('bind nothing else, leaving every other key to the browser', () => {
    expect(SHORTCUTS.size).toBe(TOOLS_IN_ORDER.length + 1);
    // Undo is Ctrl+Z, which the app binds itself: a modifier is not one key.
    expect(SHORTCUTS.get('z')).toBeUndefined();
  });
});
