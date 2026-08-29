import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../ui/toolbar';

/**
 * The shortcuts are derived from the strip, so what is worth checking is the
 * promise the numbers make: 1 to 8 are the tools, in the order you see them.
 * Insert a tool without renumbering and this is what says so.
 *
 * The eraser is eighth and the text tool ninth for that reason, and both keep
 * their numbers on a touch device even though neither cell is shown there -- the
 * app is what refuses to arm them (see App.setTool), not the list of keys.
 */

const TOOLS_IN_ORDER = [
  'wall', 'rectangle', 'border', 'pedestrian', 'goal', 'select', 'shift', 'erase', 'text',
];

describe('the keyboard shortcuts', () => {
  it('number the tools down the capsule', () => {
    TOOLS_IN_ORDER.forEach((id, i) => {
      expect(SHORTCUTS.get(String(i + 1))).toEqual({ key: id, kind: 'tool' });
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
