import { describe, it, expect } from 'vitest';
import { Agents, packRgb, unpackRgb } from '../sim/agents';

/** The undo stack is nothing but these two calls, so this is what undo is. */
describe('Agents snapshot/restore', () => {
  it('puts back the crowd exactly as it was', () => {
    const agents = new Agents(8);
    agents.add([10, 20], [255, 0, 0]);
    agents.add([30, 40], [0, 255, 0]);
    agents.setGoal(1, 7, [0, 0, 255]);
    agents.selected[0] = 1;

    const snap = agents.snapshot();

    // Everything the edit that follows could touch.
    agents.add([50, 60]);
    agents.x[0] = 999;
    agents.goal[0] = 3;
    agents.selected[0] = 0;
    agents.arrived[1] = 1;

    agents.restore(snap);

    expect(agents.count).toBe(2);
    expect([agents.x[0], agents.y[0]]).toEqual([10, 20]);
    expect([agents.x[1], agents.y[1]]).toEqual([30, 40]);
    expect([agents.originX[0], agents.originY[0]]).toEqual([10, 20]);
    expect(agents.goal[0]).toBe(-1);
    expect(agents.goal[1]).toBe(7);
    expect(unpackRgb(agents.color[1])).toEqual([0, 0, 255]);
    expect(agents.arrived[1]).toBe(0);
    expect(agents.selected[0]).toBe(1);
  });

  it('is a copy, not a view: later movement does not rewrite the snapshot', () => {
    const agents = new Agents(4);
    agents.add([0, 0]);
    const snap = agents.snapshot();
    agents.x[0] = 500;
    agents.restore(snap);
    expect(agents.x[0]).toBe(0);
  });

  it('clears the per-tick working state, which belongs to the old map', () => {
    const agents = new Agents(4);
    agents.add([0, 0]);
    const snap = agents.snapshot();
    agents.hasWaypoint[0] = 1;
    agents.waypointNode[0] = 12;
    agents.costToGoal[0] = 42;

    agents.restore(snap);

    expect(agents.hasWaypoint[0]).toBe(0);
    expect(agents.waypointNode[0]).toBe(-1);
    expect(agents.costToGoal[0]).toBe(Infinity);
  });

  it('restores a crowd larger than the array it grew from', () => {
    const agents = new Agents(2);
    for (let i = 0; i < 9; i++) agents.add([i, i]);
    const snap = agents.snapshot();
    agents.clear();
    agents.restore(snap);
    expect(agents.count).toBe(9);
    expect([agents.x[8], agents.y[8]]).toEqual([8, 8]);
  });

  it('an empty snapshot empties the crowd, which is what undoing a clear needs', () => {
    const agents = new Agents(4);
    const snap = agents.snapshot();
    agents.add([1, 1]);
    agents.restore(snap);
    expect(agents.count).toBe(0);
  });

  it('keeps colours packed as they were', () => {
    const agents = new Agents(4);
    agents.add([0, 0], [12, 34, 56]);
    const snap = agents.snapshot();
    agents.color[0] = packRgb([200, 200, 200]);
    agents.restore(snap);
    expect(unpackRgb(agents.color[0])).toEqual([12, 34, 56]);
  });
});

/**
 * What a recording watches for so it can stop itself: the moment there is
 * nothing left in the crowd that is going anywhere.
 */
describe('Agents.allArrived', () => {
  it('is false while anyone bound for a goal is still walking', () => {
    const agents = new Agents(4);
    agents.add([0, 0]);
    agents.add([10, 10]);
    agents.setGoal(0, 1, [0, 0, 255]);
    agents.setGoal(1, 1, [0, 0, 255]);
    agents.arrived[0] = 1;

    expect(agents.allArrived).toBe(false);
  });

  it('is true once every one of them has got there', () => {
    const agents = new Agents(4);
    agents.add([0, 0]);
    agents.add([10, 10]);
    agents.setGoal(0, 1, [0, 0, 255]);
    agents.setGoal(1, 1, [0, 0, 255]);
    agents.arrived[0] = 1;
    agents.arrived[1] = 1;

    expect(agents.allArrived).toBe(true);
  });

  it('does not wait on a pedestrian that was never going anywhere', () => {
    const agents = new Agents(4);
    agents.add([0, 0]);
    agents.add([10, 10]);
    agents.setGoal(0, 1, [0, 0, 255]);
    agents.arrived[0] = 1;

    expect(agents.allArrived).toBe(true);
  });

  it('is false for a crowd with no goal between them, and for no crowd at all', () => {
    const agents = new Agents(4);
    expect(agents.allArrived).toBe(false);
    agents.add([0, 0]);
    expect(agents.allArrived).toBe(false);
  });
});

/**
 * A retreat is per-tick working state, so none of the three ways a crowd is put
 * back may leave one half-walked. A pedestrian restored mid-retreat would come
 * back white, walking away from a goal it no longer remembers giving up on.
 */
describe('a retreat does not survive being put back', () => {
  /** A crowd with the middle one part-way through giving up. */
  function fleeing() {
    const agents = new Agents(8);
    agents.add([10, 20], [255, 0, 0]);
    agents.add([30, 40], [0, 255, 0]);
    agents.add([50, 60], [0, 0, 255]);
    for (let i = 0; i < 3; i++) agents.setGoal(i, 7, [1, 2, 3]);
    agents.crush[1] = 40;
    agents.fleeLeft[1] = 120;
    agents.refugeX[1] = -400;
    agents.refugeY[1] = -400;
    agents.surrenders = 1;
    return agents;
  }

  it('undo clears it', () => {
    const agents = fleeing();
    agents.restore(agents.snapshot());
    for (let i = 0; i < agents.count; i++) {
      expect(agents.fleeLeft[i]).toBe(0);
      expect(agents.crush[i]).toBe(0);
    }
    expect(agents.surrenders).toBe(0);
  });

  it('reset clears it', () => {
    const agents = fleeing();
    agents.resetPositions(new Map([[7, [1, 2, 3] as const]]));
    for (let i = 0; i < agents.count; i++) {
      expect(agents.fleeLeft[i]).toBe(0);
      expect(agents.crush[i]).toBe(0);
    }
    expect(agents.surrenders).toBe(0);
  });

  it('erasing a pedestrian moves the retreat with the one that fills the slot', () => {
    // removeAt swaps the last agent down, so every field has to travel together.
    // A missed one leaves the survivor wearing somebody else's retreat.
    const agents = fleeing();
    agents.fleeLeft[2] = 90;
    agents.refugeX[2] = 11;
    agents.refugeY[2] = 22;
    agents.removeAt(0);
    expect(agents.count).toBe(2);
    // Slot 0 now holds what was slot 2.
    expect(agents.fleeLeft[0]).toBe(90);
    expect([agents.refugeX[0], agents.refugeY[0]]).toEqual([11, 22]);
    expect(agents.fleeLeft[1]).toBe(120);
    expect([agents.refugeX[1], agents.refugeY[1]]).toEqual([-400, -400]);
  });

  it('losing the goal ends the retreat, so nothing is left white', () => {
    const agents = fleeing();
    agents.clearGoal(7);
    for (let i = 0; i < agents.count; i++) {
      expect(agents.fleeLeft[i]).toBe(0);
      expect(agents.crush[i]).toBe(0);
    }
  });
});
