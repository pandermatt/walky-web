import { describe, expect, it } from 'vitest';
import { Viewport, ZOOM_FACTOR, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../render/viewport';

function view(): Viewport {
  const v = new Viewport();
  v.width = 400;
  v.height = 300;
  return v;
}

describe('Viewport.zoomByRatio', () => {
  it('scales by the ratio the fingers measured', () => {
    const v = view();
    v.zoomByRatio([200, 150], 2);
    expect(v.scale).toBeCloseTo(2, 10);
    v.zoomByRatio([200, 150], 0.5);
    expect(v.scale).toBeCloseTo(1, 10);
  });

  it('leaves the world point under the pinch where it was', () => {
    const v = view();
    v.targetX = 37;
    v.targetY = -19;
    const anchor: [number, number] = [310, 80];
    const before = v.screenToWorld(anchor);
    v.zoomByRatio(anchor, 3.7);
    const after = v.screenToWorld(anchor);
    expect(after[0]).toBeCloseTo(before[0], 8);
    expect(after[1]).toBeCloseTo(before[1], 8);
  });

  it('lands between the notches a wheel is limited to', () => {
    const v = view();
    v.zoomByRatio([200, 150], 1.4);
    expect(Number.isInteger(v.zoomLevel)).toBe(false);
    // Still the same level -> scale relationship the wheel uses.
    expect(v.scale).toBeCloseTo(Math.pow(ZOOM_FACTOR, -v.zoomLevel), 10);
  });

  it('clamps to the same limits the wheel has', () => {
    const zoomedIn = view();
    zoomedIn.zoomByRatio([200, 150], 1e9);
    expect(zoomedIn.zoomLevel).toBe(ZOOM_LEVEL_MIN);

    const zoomedOut = view();
    zoomedOut.zoomByRatio([200, 150], 1e-9);
    expect(zoomedOut.zoomLevel).toBe(ZOOM_LEVEL_MAX);
  });

  it('ignores a ratio a degenerate pinch would produce', () => {
    const v = view();
    v.zoomByRatio([200, 150], 2);
    const level = v.zoomLevel;
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      v.zoomByRatio([200, 150], bad);
      expect(v.zoomLevel).toBe(level);
    }
  });

  it('agrees with the wheel when handed a whole notch', () => {
    const wheel = view();
    wheel.zoomAt([310, 80], -3);

    const fingers = view();
    fingers.zoomByRatio([310, 80], Math.pow(ZOOM_FACTOR, 3));

    expect(fingers.zoomLevel).toBeCloseTo(wheel.zoomLevel, 10);
    expect(fingers.targetX).toBeCloseTo(wheel.targetX, 8);
    expect(fingers.targetY).toBeCloseTo(wheel.targetY, 8);
  });
});
