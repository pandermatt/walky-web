import { describe, it, expect } from 'vitest';
import { Agents } from '../sim/agents';
import {
  DEFAULT_SETTINGS, makeGenerator, generatorContains, generatorSquare,
  generatorRoundedSquare, GENERATOR_CELLS,
} from '../state/model';

/**
 * What separates the flow from the crowd.
 *
 * A generator's pedestrians are the run rather than the map: they are marked on
 * the way in and taken off the map the moment they arrive, so a door left running
 * does not slowly bury the goal it is aimed at.
 */
describe('generator pedestrians', () => {
  it('are marked as the run\'s, where a painted one is not', () => {
    const agents = new Agents(8);
    agents.add([10, 10]);
    agents.addSpawned([20, 20], 7, [1, 2, 3]);
    expect([...agents.spawned.slice(0, 2)]).toEqual([0, 1]);
    expect(agents.goal[1]).toBe(7);
  });

  it('go when they arrive, and take the painted crowd nowhere with them', () => {
    const agents = new Agents(8);
    const painted = agents.add([10, 10]);
    agents.addSpawned([20, 20], 7, [1, 2, 3]);
    agents.addSpawned([30, 30], 7, [1, 2, 3]);
    agents.arrived[painted] = 1;
    agents.arrived[1] = 1;
    agents.arrived[2] = 1;

    expect(agents.removeArrivedSpawned()).toBe(2);
    expect(agents.count).toBe(1);
    expect([agents.x[0], agents.y[0]]).toEqual([10, 10]);
  });

  it('stay while they are still walking', () => {
    const agents = new Agents(8);
    agents.addSpawned([20, 20], 7, [1, 2, 3]);
    expect(agents.removeArrivedSpawned()).toBe(0);
    expect(agents.count).toBe(1);
  });

  /**
   * removeAt swaps the last agent down into the freed slot, so a removal loop
   * that walked upwards would step straight over whatever landed behind it.
   */
  it('are all taken however they are interleaved with the crowd', () => {
    const agents = new Agents(16);
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) agents.add([i, 0]);
      else agents.addSpawned([i, 0], 7, [1, 2, 3]);
      agents.arrived[i] = 1;
    }
    expect(agents.removeArrivedSpawned()).toBe(5);
    expect(agents.count).toBe(5);
    expect([...agents.spawned.slice(0, 5)]).toEqual([0, 0, 0, 0, 0]);
  });

  it('are cleared outright by Reset, having no starting line to go back to', () => {
    const agents = new Agents(8);
    agents.add([10, 10]);
    agents.addSpawned([20, 20], 7, [1, 2, 3]);
    expect(agents.removeSpawned()).toBe(1);
    expect(agents.count).toBe(1);
    expect(agents.spawned[0]).toBe(0);
  });

  it('survive undo as what they are', () => {
    const agents = new Agents(8);
    agents.add([10, 10]);
    agents.addSpawned([20, 20], 7, [1, 2, 3]);
    const snap = agents.snapshot();
    agents.removeSpawned();
    agents.restore(snap);
    expect(agents.count).toBe(2);
    expect([...agents.spawned.slice(0, 2)]).toEqual([0, 1]);
  });
});

describe('a generator', () => {
  it('starts unpinned, which is what stops it emitting into nowhere', () => {
    const g = makeGenerator([0, 0], 5);
    expect(g.goal).toBe(-1);
    expect(g.owed).toBe(0);
    expect(g.rate).toBe(5);
  });

  it('takes its footprint from the pedestrian radius, not from a stored size', () => {
    const g = makeGenerator([100, 100], 4);
    const r = DEFAULT_SETTINGS.pedestrianRadius;
    const half = GENERATOR_CELLS * r;
    expect(generatorSquare(g.at, r)).toEqual([
      [100 - half, 100 - half], [100 + half, 100 - half],
      [100 + half, 100 + half], [100 - half, 100 + half],
    ]);
    expect(generatorContains(g, [100 + half - 1, 100], r)).toBe(true);
    expect(generatorContains(g, [100 + half + 1, 100], r)).toBe(false);
    // Half the radius, half the block: the door is the size of the people.
    expect(generatorContains(g, [100 + half - 1, 100], r / 2)).toBe(false);
  });

  it('is drawn as a rounded square, inside the footprint and reaching its edges', () => {
    const r = DEFAULT_SETTINGS.pedestrianRadius;
    const half = GENERATOR_CELLS * r;
    const shape = generatorRoundedSquare([100, 100], r);

    const xs = shape.map((p) => p[0]);
    const ys = shape.map((p) => p[1]);
    // It fills the same box the footprint does -- the corners are taken off, the
    // sides are not pulled in -- so framing and layout are unchanged by rounding.
    expect(Math.min(...xs)).toBeCloseTo(100 - half);
    expect(Math.max(...xs)).toBeCloseTo(100 + half);
    expect(Math.min(...ys)).toBeCloseTo(100 - half);
    expect(Math.max(...ys)).toBeCloseTo(100 + half);
    // And no point of it lies outside that box.
    for (const [x, y] of shape) {
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(y - 100)).toBeLessThanOrEqual(half + 1e-9);
    }
    // The corner itself is gone: the footprint has a point there, the block does
    // not, and neither does the hit test.
    expect(generatorSquare([100, 100], r)).toContainEqual([100 + half, 100 + half]);
    expect(shape).not.toContainEqual([100 + half, 100 + half]);
    const g = makeGenerator([100, 100], 4);
    expect(generatorContains(g, [100 + half - 1, 100 + half - 1], r)).toBe(false);
    expect(generatorContains(g, [100, 100 + half - 1], r)).toBe(true);
  });
});
