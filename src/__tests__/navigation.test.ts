import { describe, it, expect } from 'vitest';
import { Navigation } from '../sim/navigation';
import { Agents } from '../sim/agents';
import { SpatialHash } from '../sim/spatialHash';
import { makeWall, rectanglePolygon } from '../state/model';
import { distance, type Point } from '../sim/geometry';

const R = 13;
const PREF = 30;

function scenario() {
  const blocker = makeWall([rectanglePolygon([100, -150], [160, 150])]);
  const goal = makeWall([rectanglePolygon([320, -60], [400, 60])]);
  goal.isGoal = true;
  const nav = new Navigation();
  nav.rebuild([blocker, goal], R);
  return { nav, goal, blocker };
}

describe('routeFrom', () => {
  it('is a straight hop when the goal is in sight', () => {
    const { nav, goal } = scenario();
    const from: Point = [200, 0];
    const route = nav.routeFrom(from, goal.id);
    expect(route).toHaveLength(2);
    expect(route[0]).toEqual(from);
    expect(nav.hasArrived(route[1], goal.id, 1)).toBe(true);
  });

  it('bends around a blocker rather than crossing it', () => {
    const { nav, goal } = scenario();
    const from: Point = [-380, -100];
    const route = nav.routeFrom(from, goal.id);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual(from);
    for (let i = 1; i < route.length; i++) {
      expect(nav.canSee(route[i - 1], route[i])).toBe(true);
    }
    // It rounds the blocker's near end instead of walking through the bar.
    expect(route.some((p) => p[1] < -150)).toBe(true);
  });

  it('predicts the route the agent then walks', () => {
    const { nav, goal } = scenario();
    const from: Point = [-380, -100];
    const predicted = nav.routeFrom(from, goal.id);

    const agents = new Agents();
    const hash = new SpatialHash();
    const i = agents.add(from);
    agents.setGoal(i, goal.id, goal.color);
    agents.step(nav, hash, 1, R, 30);

    // What the running overlay draws for the same agent, one step in.
    const walked = nav.pathFromNode(agents.waypointNode[i], goal.id);
    expect(walked.length).toBeGreaterThan(0);
    // The agent has moved a step, so the head differs; the corners do not.
    expect(predicted.slice(1)).toEqual(walked);
  });

  it('has nothing to draw for a goal that is walled off', () => {
    const goal = makeWall([rectanglePolygon([-20, -20], [20, 20])]);
    goal.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([goal], R);
    // A wall id that is not a goal has no field to read.
    expect(nav.routeFrom([200, 200], goal.id + 99)).toEqual([]);
  });

  it('leaves an agent standing on a node with a route that still moves it on', () => {
    const { nav, goal } = scenario();
    // Exactly on a graph node: the scan must not pick the node it stands on.
    const node = nav.nodes.find((p) => p[0] < 100 && p[1] < -150)!;
    const route = nav.routeFrom(node, goal.id);
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(distance(route[0], route[1])).toBeGreaterThan(0);
  });
});

describe('several goals at once', () => {
  /** Two goal walls either side of the origin, and no obstacle between. */
  function twoGoals() {
    const east = makeWall([rectanglePolygon([300, -60], [380, 60])]);
    const west = makeWall([rectanglePolygon([-380, -60], [-300, 60])]);
    east.isGoal = true;
    west.isGoal = true;
    const nav = new Navigation();
    nav.rebuild([east, west], R);
    return { nav, east, west };
  }

  it('keeps a field for every marked wall', () => {
    const { nav, east, west } = twoGoals();
    expect(nav.hasGoal(east.id)).toBe(true);
    expect(nav.hasGoal(west.id)).toBe(true);
  });

  it('walks two pedestrians to their own goal', () => {
    const { nav, east, west } = twoGoals();
    const agents = new Agents();
    const hash = new SpatialHash();
    // Started on the far side of the goal they are not heading for, so a crossed
    // wire would show up as the wrong arrival rather than as a shorter walk.
    const goingEast = agents.add([-100, 0]);
    const goingWest = agents.add([100, 0]);
    agents.setGoal(goingEast, east.id, east.color);
    agents.setGoal(goingWest, west.id, west.color);

    for (let step = 0; step < 400; step++) agents.step(nav, hash, 4, R, PREF);

    expect(agents.arrived[goingEast]).toBe(1);
    expect(agents.arrived[goingWest]).toBe(1);
    expect(nav.hasArrived([agents.x[goingEast], agents.y[goingEast]], east.id, R + 1)).toBe(true);
    expect(nav.hasArrived([agents.x[goingWest], agents.y[goingWest]], west.id, R + 1)).toBe(true);
  });
});
