import type { Point } from '../sim/geometry';
import { EMPTY_PREVIEW, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Marks a wall as the goal, from controller/MarkGoalToolMouseListener.
 *
 * While the tool is active it draws a line from every pedestrian it would affect
 * to the pointer, which is the original's drawMarkTargetLine. The original turned
 * those lines yellow when the pointer was over a wall; here they take the colour
 * of the wall underneath, so you can see which goal you are about to assign --
 * and, since pedestrians wear their goal's colour, what the crowd will become.
 *
 * If a selection exists the goal applies to it alone (Map.setGoalForSelected
 * Pedestrians); with nothing selected it applies to everyone, which is what the
 * original did when no elements were selected.
 *
 * A click that lands on no wall says so and changes nothing, selection and tool
 * included: there is a goal still to be marked.
 */
export class GoalTool implements Tool {
  readonly id = 'goal' as const;
  readonly cursor = 'crosshair';
  private mouse: Point | null = null;
  private color: [number, number, number] | null = null;

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    if (!ctx.setGoalAt(e.world)) {
      // A goal is a wall, so a click on empty ground assigned nothing. Say so,
      // and leave both the tool and the selection it was aimed at alone -- the
      // click was a miss, and clearing up after a miss would mean lassoing the
      // same group again to have another go.
      ctx.notify('No wall there — click a wall to make it the goal.');
      return;
    }
    // Assigning a goal completes the gesture: drop the selection it applied to,
    // and step off the tool so the next click cannot reassign by accident.
    ctx.clearSelection();
    ctx.deactivateTool();
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
