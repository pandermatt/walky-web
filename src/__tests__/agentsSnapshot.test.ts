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
    agents.speedCounter[0] = 1.5;
    agents.costToGoal[0] = 42;

    agents.restore(snap);

    expect(agents.hasWaypoint[0]).toBe(0);
    expect(agents.waypointNode[0]).toBe(-1);
    expect(agents.speedCounter[0]).toBe(0);
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
