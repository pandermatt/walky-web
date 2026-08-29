import { describe, it, expect } from 'vitest';
import { EraseTool } from '../tools/eraseTool';
import { DEFAULT_SETTINGS } from '../state/model';
import type { Point } from '../sim/geometry';
import type { EraseTarget, PointerInfo, ToolContext } from '../tools/types';

interface Recorded {
  /** Every erase asked for: where, and whether it was told it was mid-sweep. */
  rubs: { at: Point; sameStroke: boolean }[];
  /** What is still on the map -- the ids of the shapes not yet erased. */
  left: Set<string>;
}

/**
 * A map with two shapes side by side: 'a' from x 0 to 100, 'b' from 200 to 300,
 * both spanning y 0 to 100. Anywhere else is open ground.
 */
function shapeAt(p: Point): string | null {
  if (p[1] < 0 || p[1] > 100) return null;
  if (p[0] >= 0 && p[0] <= 100) return 'a';
  if (p[0] >= 200 && p[0] <= 300) return 'b';
  return null;
}

function stubContext(): { ctx: ToolContext; rec: Recorded } {
  const rec: Recorded = { rubs: [], left: new Set(['a', 'b']) };
  const here = (at: Point) => {
    const id = shapeAt(at);
    return id && rec.left.has(id) ? id : null;
  };
  const ctx = {
    addWall: () => true,
    addWallShape: () => true,
    settings: () => DEFAULT_SETTINGS,
    pedestrianBlock: () => [],
    addPedestrians: () => {},
    setGoalAt: () => false,
    selectPedestrianAt: () => {},
    selectPedestriansIn: () => {},
    clearSelection: () => {},
    selectionCount: () => 0,
    deactivateTool: () => {},
    activateTool: () => {},
    notify: () => {},
    panBy: () => {},
    requestRender: () => {},
    colorAt: () => null,
    agentPositions: () => [],
    worldPerPixel: () => 1,
    eraseTargetAt: (at: Point): EraseTarget | null => {
      const id = here(at);
      // 'a' is wall 1 and 'b' is wall 2, so the preview can be checked against
      // which of the two the pointer is actually over.
      return id ? { kind: 'wall', id: id === 'a' ? 1 : 2, outlines: [[[0, 0], [1, 0], [1, 1]]] } : null;
    },
    eraseAt: (at: Point, sameStroke: boolean) => {
      rec.rubs.push({ at, sameStroke });
      const id = here(at);
      if (!id) return false;
      rec.left.delete(id);
      return true;
    },
  } satisfies ToolContext;
  return { ctx, rec };
}

function at(world: Point, buttons = 1): PointerInfo {
  return { world, screen: world, dxScreen: 0, dyScreen: 0, shiftKey: false, buttons };
}

describe('EraseTool', () => {
  it('takes the shape it is pressed on', () => {
    const { ctx, rec } = stubContext();
    new EraseTool().onPointerDown(at([50, 50]), ctx);
    expect(rec.left).toEqual(new Set(['b']));
  });

  it('leaves open ground alone, and takes no undo step for it', () => {
    const { ctx, rec } = stubContext();
    const tool = new EraseTool();
    tool.onPointerDown(at([150, 50]), ctx);
    expect(rec.left).toEqual(new Set(['a', 'b']));
    // The first real removal is still the start of the stroke, so it is the one
    // that checkpoints -- a drag that begins on nothing must still be undoable.
    tool.onPointerMove(at([50, 50]), ctx);
    expect(rec.rubs.map((r) => r.sameStroke)).toEqual([false, false]);
    expect(rec.left).toEqual(new Set(['b']));
  });

  it('sweeps across several shapes as one thing to take back', () => {
    const { ctx, rec } = stubContext();
    const tool = new EraseTool();
    tool.onPointerDown(at([50, 50]), ctx);
    tool.onPointerMove(at([150, 50]), ctx);
    tool.onPointerMove(at([250, 50]), ctx);
    expect(rec.left).toEqual(new Set());
    // Only the press opens a step; everything after it joins the same one.
    expect(rec.rubs.map((r) => r.sameStroke)).toEqual([false, true, true]);
  });

  it('starts a new step for the next stroke', () => {
    const { ctx, rec } = stubContext();
    const tool = new EraseTool();
    tool.onPointerDown(at([50, 50]), ctx);
    tool.onPointerUp();
    tool.onPointerDown(at([250, 50]), ctx);
    expect(rec.rubs.map((r) => r.sameStroke)).toEqual([false, false]);
  });

  it('erases nothing while merely hovering', () => {
    const { ctx, rec } = stubContext();
    new EraseTool().onPointerMove(at([50, 50], 0), ctx);
    expect(rec.rubs).toEqual([]);
    expect(rec.left).toEqual(new Set(['a', 'b']));
  });

  it('ignores a press that is not the left button', () => {
    const { ctx, rec } = stubContext();
    new EraseTool().onPointerDown(at([50, 50], 2), ctx);
    expect(rec.rubs).toEqual([]);
  });

  it('outlines what a click would take, as a warning rather than a proposal', () => {
    const { ctx } = stubContext();
    const tool = new EraseTool();
    tool.onPointerMove(at([50, 50], 0), ctx);
    const over = tool.preview();
    expect(over.pendingPolygons).toHaveLength(1);
    expect(over.pendingPolygonsInvalid).toBe(true);
    expect(over.cursorGhost?.kind).toBe('eraser');
    // Named as well as outlined, so the layer underneath can fade the body of
    // the shape and not just its edge.
    expect(over.erasing).toEqual({ kind: 'wall', id: 1, outlines: [[[0, 0], [1, 0], [1, 1]]] });

    // Over open ground the badge stays -- the tool is still in hand -- but there
    // is nothing outlined, because nothing is about to go.
    tool.onPointerMove(at([150, 50], 0), ctx);
    expect(tool.preview().pendingPolygons).toEqual([]);
    expect(tool.preview().erasing).toBeNull();
    expect(tool.preview().cursorGhost?.kind).toBe('eraser');
  });

  it('drops the highlight when it is put down', () => {
    const { ctx } = stubContext();
    const tool = new EraseTool();
    tool.onPointerMove(at([50, 50], 0), ctx);
    tool.cancel();
    expect(tool.preview().pendingPolygons).toEqual([]);
    expect(tool.preview().erasing).toBeNull();
    expect(tool.preview().cursorGhost).toBeNull();
  });
});
