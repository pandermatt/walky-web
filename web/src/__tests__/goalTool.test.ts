import { describe, it, expect } from 'vitest';
import { GoalTool } from '../tools/goalTool';
import { DEFAULT_SETTINGS } from '../state/model';
import type { Point } from '../sim/geometry';
import type { PointerInfo, ToolContext, ToolId } from '../tools/types';

interface Recorded {
  /** Points the tool asked to make a goal. */
  marked: Point[];
  messages: string[];
  /** How many times the selection was dropped. */
  cleared: number;
  /** Tool the context was asked to arm; null is "nothing armed". */
  armed: (ToolId | null)[];
}

/** A context with a single wall, the square from [0,0] to [100,100]. */
function stubContext(): { ctx: ToolContext; rec: Recorded } {
  const onWall = (p: Point) => p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= 100;
  const rec: Recorded = { marked: [], messages: [], cleared: 0, armed: [] };
  const ctx = {
    addWall: () => true,
    addWallShape: () => true,
    settings: () => DEFAULT_SETTINGS,
    pedestrianBlock: () => [],
    addPedestrians: () => {},
    addGenerator: () => true,
    setGoalAt: (at: Point) => {
      if (!onWall(at)) return false;
      rec.marked.push(at);
      return true;
    },
    selectPedestrianAt: () => {},
    selectPedestriansIn: () => {},
    clearSelection: () => { rec.cleared++; },
    selectionCount: () => 3,
    deactivateTool: () => rec.armed.push(null),
    activateTool: (id: ToolId) => rec.armed.push(id),
    notify: (message: string) => rec.messages.push(message),
    panBy: () => {},
    requestRender: () => {},
    colorAt: (at: Point) => (onWall(at) ? [1, 2, 3] as [number, number, number] : null),
    agentPositions: () => [],
    worldPerPixel: () => 1,
    // The tool under test neither erases nor writes; those have their own files.
    eraseTargetAt: () => null,
    eraseAt: () => false,
    editTextAt: () => {},
  } satisfies ToolContext;
  return { ctx, rec };
}

function at(world: Point): PointerInfo {
  return { world, screen: world, dxScreen: 0, dyScreen: 0, shiftKey: false, buttons: 1 };
}

describe('GoalTool', () => {
  it('marks the wall it is clicked on, then steps off the tool', () => {
    const { ctx, rec } = stubContext();
    new GoalTool().onPointerDown(at([50, 50]), ctx);
    expect(rec.marked).toEqual([[50, 50]]);
    expect(rec.cleared).toBe(1);
    expect(rec.armed).toEqual([null]);
  });

  it('says so on a click that lands on no wall', () => {
    const { ctx, rec } = stubContext();
    new GoalTool().onPointerDown(at([500, 500]), ctx);
    expect(rec.marked).toEqual([]);
    expect(rec.messages).toHaveLength(1);
    expect(rec.messages[0]).toMatch(/wall/);
  });

  it('keeps the tool and the selection after a miss, so the next click can land', () => {
    const { ctx, rec } = stubContext();
    const tool = new GoalTool();
    tool.onPointerDown(at([500, 500]), ctx);
    // Nothing stepped off, nothing dropped: the same gesture can be retried.
    expect(rec.armed).toEqual([]);
    expect(rec.cleared).toBe(0);

    tool.onPointerDown(at([50, 50]), ctx);
    expect(rec.marked).toEqual([[50, 50]]);
    expect(rec.armed).toEqual([null]);
  });
});
