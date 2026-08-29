import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../ui/toolbar';

/**
 * The shortcuts are derived from the strip, so what is worth checking is the
 * promise the numbers make: the digits are the tools, in the order you see them.
 * Insert a tool without renumbering and this is what says so.
 *
 * The eraser is eighth, the text tool ninth and the generator tenth for that
 * reason, and all three keep their numbers on a touch device even though none of
 * the cells is shown there -- the app is what refuses to arm them (see
 * App.setTool), not the list of keys.
 *
 * The tenth is on 0, because ten is where a row of digits runs out and 0 is the
 * key that follows 9 along it. An eleventh tool has nowhere to go, which is a
 * fact about the keyboard rather than a rule of ours.
 */

const TOOLS_IN_ORDER = [
  'wall', 'rectangle', 'border', 'pedestrian', 'goal', 'select', 'shift', 'erase', 'text',
  'generator',
];

/** The digit a tool sits on: its place down the capsule, with the tenth on 0. */
const digit = (index: number) => String((index + 1) % 10);

describe('the keyboard shortcuts', () => {
  it('number the tools down the capsule', () => {
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
