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

describe('Viewport.reset', () => {
  it('brings the drawing back after panning away from it', () => {
    const v = view();
    const bounds = { minX: -50, minY: -40, maxX: 50, maxY: 40 };
    v.zoomAt([200, 150], 6);
    v.panBy(-4000, -3000);
    expect(v.worldToScreen([0, 0])[0]).toBeLessThan(0); // the map is off screen

    v.reset(bounds);

    expect(v.zoomLevel).toBe(0);
    expect(v.targetX).toBe(0);
    expect(v.targetY).toBe(0);
    const centre = v.worldToScreen([0, 0]);
    expect(centre[0]).toBeCloseTo(v.width / 2, 8);
    expect(centre[1]).toBeCloseTo(v.height / 2, 8);
  });

  it('centres on the drawing wherever it was made', () => {
    const v = view();
    v.reset({ minX: 900, minY: 400, maxX: 1000, maxY: 500 });
    expect(v.zoomLevel).toBe(0);
    expect(v.targetX).toBe(950);
    expect(v.targetY).toBe(450);
    const corner = v.worldToScreen([900, 400]);
    expect(corner[0]).toBeGreaterThan(0);
    expect(corner[1]).toBeGreaterThan(0);
  });

  it('zooms out far enough for a map too big for the starting zoom', () => {
    const v = view();
    const bounds = { minX: -600, minY: -450, maxX: 600, maxY: 450 };
    v.reset(bounds);
    expect(v.zoomLevel).toBeGreaterThan(0);
    for (const corner of [[-600, -450], [600, 450]] as [number, number][]) {
      const [sx, sy] = v.worldToScreen(corner);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(v.width);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(v.height);
    }
  });

  it('goes to the origin at the starting zoom with nothing drawn', () => {
    const v = view();
    v.zoomAt([200, 150], -4);
    v.panBy(500, 500);
    v.reset(null);
    expect(v.zoomLevel).toBe(0);
    expect(v.targetX).toBe(0);
    expect(v.targetY).toBe(0);
  });
});
