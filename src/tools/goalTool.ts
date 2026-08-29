import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Marks a wall as the goal, from controller/MarkGoalToolMouseListener.
 *
 * While the tool is active it draws a line from every pedestrian to the pointer,
 * which is the original's drawMarkTargetLine. The original turned those lines
 * yellow when the pointer was over a wall; here they take the colour of the wall
 * underneath, so you can see which goal you are about to assign -- and, since
 * pedestrians wear their goal's colour, what the crowd is about to turn into.
 */
export class GoalTool implements Tool {
  readonly id = 'goal' as const;
  readonly cursor = 'crosshair';
  private mouse: Point | null = null;
  private color: [number, number, number] | null = null;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    ctx.setGoalAt(e.world);
  }

  onPointerMove(e: PointerInfo, ctx: ToolContext): void {
    this.mouse = e.world;
    this.color = ctx.colorAt(e.world);
    ctx.requestRender();
  }

  cancel(): void {
    this.mouse = null;
    this.color = null;
  }

  preview(): ToolPreview {
    if (!this.mouse) return EMPTY_PREVIEW;
    return {
      ...EMPTY_PREVIEW,
      targetLines: { to: this.mouse, color: this.color },
      cursorGhost: { kind: 'target', at: this.mouse, size: 10 },
    };
  }
}
