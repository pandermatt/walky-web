import { describe, it, expect } from 'vitest';
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { Navigation } from '../sim/navigation';
import { SQRT2 } from '../sim/behaviour';
import { makeWall, rectanglePolygon } from '../state/model';

const R = 13, PREF = 30;

function scenario() {
  const blocker = makeWall([rectanglePolygon([100, -150], [160, 150])]);
  const goal = makeWall([rectanglePolygon([320, -60], [400, 60])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([blocker, goal], R);
  return { nav, goal, blocker };
}

describe('behaviour', () => {
  it('a lone agent actually reaches its goal', () => {
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([-380, -100]);
    agents.setGoal(i, goal.id, goal.color);

    for (let t = 0; t < 3000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 1, R, PREF);
    }
    expect(agents.arrived[i]).toBe(1);
  });

  it('does not deadlock when a diagonal step comes due', () => {
    // Regression: the counter is clamped to exactly sqrt(2) and a diagonal costs
    // exactly sqrt(2). Stored as float32 the clamp lands just below the cost, so
    // the agent could never afford the turn and froze with its counter full.
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    // A shallow angle guarantees a long run of straight steps before a diagonal.
    const i = agents.add([-380, -140]);
    agents.setGoal(i, goal.id, goal.color);

    const startX = agents.x[i];
    for (let t = 0; t < 200; t++) agents.step(nav, hash, 1, R, PREF);

    expect(agents.x[i] - startX).toBeGreaterThan(100);
    expect(agents.speedCounter[i]).toBeLessThan(SQRT2);
  });

  it('drains a packed block rather than churning in place', () => {
    // Every agent sits inside its neighbours' preferred space. Without the
    // priority rule from Map.getColosionPedestrian they all yield to each other
    // and the block never moves.
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const i = agents.add([-400 + a * 40, -100 + b * 40]);
        agents.setGoal(i, goal.id, goal.color);
      }
    }
    const meanX = () => {
      let s = 0;
      for (let i = 0; i < agents.count; i++) s += agents.x[i];
      return s / agents.count;
    };
    const before = meanX();
    for (let t = 0; t < 400; t++) agents.step(nav, hash, 1, R, PREF);
    // A jammed crowd advances at a fraction of free speed -- roughly a third of
    // the 400px an unobstructed agent would cover. The point of the assertion is
    // that it drains at all: the churning failure mode scores about zero.
    expect(meanX() - before).toBeGreaterThan(100);
  });

  it('keeps agents out of walls the whole way', () => {
    const { nav, goal, blocker } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    for (let b = 0; b < 6; b++) {
      const i = agents.add([-300, -120 + b * 45]);
      agents.setGoal(i, goal.id, goal.color);
    }
    for (let t = 0; t < 1500; t++) {
      agents.step(nav, hash, 1, R, PREF);
      for (let i = 0; i < agents.count; i++) {
        // Never inside the raw blocker polygon.
        const x = agents.x[i], y = agents.y[i];
        const inside = x > 100 && x < 160 && y > -150 && y < 150;
        expect(inside).toBe(false);
      }
    }
    void blocker;
  });
});

describe('pedestrian placement', () => {
  it('never places two pedestrians on top of each other', () => {
    // Mirrors what the brush does: repeated placements at overlapping spots.
    const agents = new Agents();
    const minGap = 2 * R;
    const place = (p: [number, number]) => {
      for (let i = 0; i < agents.count; i++) {
        if (Math.hypot(agents.x[i] - p[0], agents.y[i] - p[1]) < minGap) return false;
      }
      agents.add(p);
      return true;
    };

    let accepted = 0;
    for (let t = 0; t < 400; t++) {
      // A tight raster that would otherwise stack many on the same few spots.
      const p: [number, number] = [(t % 20) * 5, Math.floor(t / 20) * 5];
      if (place(p)) accepted++;
    }
    expect(accepted).toBe(agents.count);

    for (let i = 0; i < agents.count; i++) {
      for (let j = i + 1; j < agents.count; j++) {
        const d = Math.hypot(agents.x[i] - agents.x[j], agents.y[i] - agents.y[j]);
        expect(d).toBeGreaterThanOrEqual(minGap);
      }
    }
  });
});

describe('pedestrian bodies never enter a wall', () => {
  it('keeps every centre at least a radius clear of the wall, under crowd pressure', () => {
    // A crowd driven hard at a blocker: the crush must not squeeze anyone's
    // circle into the wall, only their centre out to the expanded hull.
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 8; b++) {
        const i = agents.add([-260 + a * 30, -110 + b * 30]);
        agents.setGoal(i, goal.id, goal.color);
      }
    }

    // Distance from a point to the blocker rectangle [100,-150]..[160,150].
    const distToBlocker = (x: number, y: number) => {
      const dx = Math.max(100 - x, 0, x - 160);
      const dy = Math.max(-150 - y, 0, y - 150);
      return Math.hypot(dx, dy);
    };

    let closest = Infinity;
    for (let t = 0; t < 1200; t++) {
      agents.step(nav, hash, 6, R, PREF);
      for (let i = 0; i < agents.count; i++) {
        if (agents.arrived[i]) continue;
        closest = Math.min(closest, distToBlocker(agents.x[i], agents.y[i]));
      }
    }
    // The expanded hull keeps centres a full radius out; allow a lattice step of
    // slack for the integer grid.
    expect(closest).toBeGreaterThanOrEqual(R - 1.5);
  });
});

describe('stuck pedestrians', () => {
  it('works its way out when it starts inside a wall\'s expanded hull', () => {
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    // Just inside the blocker's expanded hull (blocker is x 100..160).
    const i = agents.add([95, 0]);
    agents.setGoal(i, goal.id, goal.color);

    const inside = () => nav.obstacles.some((ob) => {
      const p: [number, number] = [agents.x[i], agents.y[i]];
      return ob.hull.some(() => false) || pointInHull(ob.hull, p);
    });
    // Simple ray-cast, local to the test.
    function pointInHull(hull: [number, number][], p: [number, number]) {
      let c = false;
      for (let a = 0, b = hull.length - 1; a < hull.length; b = a++) {
        if ((hull[a][1] > p[1]) !== (hull[b][1] > p[1])
          && p[0] < ((hull[b][0] - hull[a][0]) * (p[1] - hull[a][1])) / (hull[b][1] - hull[a][1]) + hull[a][0]) c = !c;
      }
      return c;
    }

    expect(inside()).toBe(true);
    let escapedAt = -1;
    for (let t = 0; t < 400; t++) {
      agents.step(nav, hash, 4, R, PREF);
      if (!inside()) { escapedAt = t; break; }
    }
    expect(escapedAt).toBeGreaterThanOrEqual(0);
  });

  it('reaches the goal after escaping, rather than just leaving the wall', () => {
    const { nav, goal } = scenario();
    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([95, 0]);
    agents.setGoal(i, goal.id, goal.color);
    for (let t = 0; t < 4000 && !agents.arrived[i]; t++) {
      agents.step(nav, hash, 4, R, PREF);
    }
    expect(agents.arrived[i]).toBe(1);
  });

  it('jiggles instead of freezing when the goal is unreachable', () => {
    // A goal sealed behind walls: there is no route, so the pedestrian should
    // keep moving rather than standing perfectly still.
    const sealed = makeWall([rectanglePolygon([100, 100], [140, 140])]);
    sealed.isGoal = true;
    const ring = [
      makeWall([rectanglePolygon([40, 40], [200, 60])]),
      makeWall([rectanglePolygon([40, 180], [200, 200])]),
      makeWall([rectanglePolygon([40, 40], [60, 200])]),
      makeWall([rectanglePolygon([180, 40], [200, 200])]),
    ];
    const nav = new Navigation();
    nav.rebuild([sealed, ...ring], R);

    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add([400, 400]);
    agents.setGoal(i, sealed.id, sealed.color);

    const seen = new Set<string>();
    for (let t = 0; t < 300; t++) {
      agents.step(nav, hash, 4, R, PREF);
      seen.add(`${agents.x[i]},${agents.y[i]}`);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(agents.arrived[i]).toBe(0);
  });
});

describe('crowd deadlock', () => {
  it('unjams a crowd that starts packed tighter than two radii', () => {
    // Regression: isLegal used to demand strict non-overlap, so a crowd already
    // closer than 2*radius had no legal move anywhere and froze permanently.
    // Reachable in normal use by raising the radius, or via the wall-escape step.
    const top = makeWall([rectanglePolygon([0, -400], [40, -60])]);
    const bottom = makeWall([rectanglePolygon([0, 60], [40, 400])]);
    const goal = makeWall([rectanglePolygon([200, -30], [260, 30])]);
    goal.isGoal = true;

    const nav = new Navigation();
    nav.rebuild([top, bottom, goal], R);
    const agents = new Agents();
    const hash = new SpatialHash();
    // 24 apart, against a required 26: everyone starts overlapping.
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const k = agents.add([-340 + i * 24, -140 + j * 24]);
        agents.setGoal(k, goal.id, goal.color);
      }
    }
    for (let t = 0; t < 2500; t++) agents.step(nav, hash, 4, R, PREF);

    let arrived = 0;
    for (let i = 0; i < agents.count; i++) if (agents.arrived[i]) arrived++;
    expect(arrived).toBe(agents.count);
  });

  it('still never creates an overlap when none exists to begin with', () => {
    const blocker = makeWall([rectanglePolygon([100, -150], [160, 150])]);
    const goal = makeWall([rectanglePolygon([320, -60], [400, 60])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([blocker, goal], R);
    const agents = new Agents();
    const hash = new SpatialHash();
    // Comfortably spaced to start, as the brush guarantees.
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const k = agents.add([-360 + i * 60, -150 + j * 60]);
        agents.setGoal(k, goal.id, goal.color);
      }
    }
    for (let t = 0; t < 600; t++) {
      agents.step(nav, hash, 4, R, PREF);
      for (let i = 0; i < agents.count; i++) {
        if (agents.arrived[i]) continue;
        for (let j = i + 1; j < agents.count; j++) {
          if (agents.arrived[j]) continue;
          const d = Math.hypot(agents.x[i] - agents.x[j], agents.y[i] - agents.y[j]);
          expect(d).toBeGreaterThanOrEqual(2 * R - 1e-6);
        }
      }
    }
  });
});

describe('selection', () => {
  it('tracks, clears and hit-tests a selection', () => {
    const agents = new Agents();
    const a = agents.add([0, 0]);
    const b = agents.add([100, 0]);
    expect(agents.selectionCount).toBe(0);

    agents.selected[a] = 1;
    expect(agents.selectionCount).toBe(1);

    // Hit testing picks the pedestrian under a point, and nothing elsewhere.
    expect(agents.indexAt([2, 2], R)).toBe(a);
    expect(agents.indexAt([100, 3], R)).toBe(b);
    expect(agents.indexAt([500, 500], R)).toBe(-1);

    agents.clearSelection();
    expect(agents.selectionCount).toBe(0);
  });

  it('keeps selection consistent when an agent is removed', () => {
    const agents = new Agents();
    agents.add([0, 0]);
    const keep = agents.add([100, 0]);
    agents.selected[keep] = 1;
    expect(agents.selectionCount).toBe(1);
    // Removing swaps the last agent into the freed slot; the flag must travel.
    agents.removeAt(0);
    expect(agents.count).toBe(1);
    expect(agents.selectionCount).toBe(1);
  });
});
