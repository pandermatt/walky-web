import { describe, it, expect } from 'vitest';
import { SelectionTool } from '../tools/selectionTool';
import { DEFAULT_SETTINGS } from '../state/model';
import { pointInPolygon, type Point } from '../sim/geometry';
import type { PointerInfo, ToolContext, ToolId } from '../tools/types';

interface Recorded {
  ctx: ToolContext;
  /** Tool the context was asked to arm, in order. */
  armed: (ToolId | null)[];
  messages: string[];
  selected: () => number;
}

/**
 * A context holding a crowd at fixed positions, so a gesture can be judged by
 * what it actually caught.
 */
function stubContext(crowd: Point[]): Recorded {
  const selected = new Set<number>();
  const armed: (ToolId | null)[] = [];
  const messages: string[] = [];
  const ctx = {
    addWall: () => true,
    addWallShape: () => true,
    settings: () => DEFAULT_SETTINGS,
    pedestrianBlock: () => [],
    addPedestrians: () => {},
    addGenerator: () => true,
    setGoalAt: () => false,
    selectPedestrianAt: (at: Point, extend: boolean) => {
      if (!extend) selected.clear();
      const hit = crowd.findIndex((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) <= 13);
      if (hit >= 0) selected.add(hit);
    },
    selectPedestriansIn: (lasso: Point[], extend: boolean) => {
      if (!extend) selected.clear();
      crowd.forEach((p, i) => { if (pointInPolygon(lasso, p)) selected.add(i); });
    },
    clearSelection: () => selected.clear(),
    selectionCount: () => selected.size,
    deactivateTool: () => armed.push(null),
    activateTool: (id: ToolId) => armed.push(id),
    notify: (message: string) => messages.push(message),
    panBy: () => {},
    requestRender: () => {},
    colorAt: () => null,
    agentPositions: () => [],
    worldPerPixel: () => 1,
    // The tool under test neither erases nor writes; those have their own files.
    eraseTargetAt: () => null,
    eraseAt: () => false,
    editTextAt: () => {},
  } satisfies ToolContext;
  return { ctx, armed, messages, selected: () => selected.size };
}

function at(world: Point, over: Partial<PointerInfo> = {}): PointerInfo {
  return { world, screen: world, dxScreen: 0, dyScreen: 0, shiftKey: false, buttons: 1, ...over };
}

/** A drag big enough to pass the drag threshold, reported as a few moves. */
function lasso(tool: SelectionTool, ctx: ToolContext, from: Point, to: Point, shift = false) {
  tool.onPointerDown(at(from, { shiftKey: shift }));
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    tool.onPointerMove(at([
      from[0] + (to[0] - from[0]) * i / steps,
      from[1] + (to[1] - from[1]) * i / steps,
    ], { shiftKey: shift }), ctx);
  }
  tool.onPointerUp(at(to, { shiftKey: shift, buttons: 0 }), ctx);
}

const CROWD: Point[] = [[100, 100], [130, 100], [100, 130]];

describe('SelectionTool', () => {
  it('hands over to the goal tool once a lasso has caught a group', () => {
    const { ctx, armed, selected } = stubContext(CROWD);
    lasso(new SelectionTool(), ctx, [60, 60], [180, 180]);
    expect(selected()).toBe(3);
    expect(armed).toEqual(['goal']);
  });

  it('hands over for a click that picks one pedestrian', () => {
    const { ctx, armed, selected } = stubContext(CROWD);
    const tool = new SelectionTool();
    tool.onPointerDown(at([100, 100]));
    tool.onPointerUp(at([100, 100], { buttons: 0 }), ctx);
    expect(selected()).toBe(1);
    expect(armed).toEqual(['goal']);
  });

  it('says so and stays in hand when a lasso catches nobody', () => {
    const { ctx, armed, messages } = stubContext(CROWD);
    lasso(new SelectionTool(), ctx, [400, 400], [520, 520]);
    expect(armed).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/pedestrians/);
  });

  it('says so for a click on something that is not a pedestrian', () => {
    const { ctx, armed, messages } = stubContext(CROWD);
    const tool = new SelectionTool();
    tool.onPointerDown(at([400, 400]));
    tool.onPointerUp(at([400, 400], { buttons: 0 }), ctx);
    expect(armed).toEqual([]);
    expect(messages).toHaveLength(1);
  });

  it('stays in hand while shift is extending a selection', () => {
    const { ctx, armed, messages, selected } = stubContext(CROWD);
    const tool = new SelectionTool();
    lasso(tool, ctx, [60, 60], [115, 115], true);
    expect(selected()).toBe(1);
    // Extend mode: more to come, so no hand-over and nothing to report.
    expect(armed).toEqual([]);
    expect(messages).toEqual([]);
  });

  it('reports a shift gesture that adds nobody, without dropping the selection', () => {
    const { ctx, armed, messages, selected } = stubContext(CROWD);
    const tool = new SelectionTool();
    lasso(tool, ctx, [60, 60], [115, 115], true);
    lasso(tool, ctx, [400, 400], [520, 520], true);
    // The standing selection would read as a hit if the count alone were asked.
    expect(selected()).toBe(1);
    expect(armed).toEqual([]);
    expect(messages).toHaveLength(1);
  });
});
