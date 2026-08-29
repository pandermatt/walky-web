import { EMPTY_PREVIEW, cursorUrl, type PointerInfo, type Tool, type ToolContext, type ToolPreview } from './types';

/**
 * Marks a wall as a goal, ported from controller/MarkGoalToolMouseListener.
 * Clicking a wall makes it the target for every pedestrian, which also recolours
 * them -- a pedestrian wears the colour of the goal it is heading for.
 */
export class GoalTool implements Tool {
  readonly id = 'goal' as const;
  readonly cursor = cursorUrl('Dart', 4, 4);

  onPointerDown(e: PointerInfo, ctx: ToolContext): void {
    if (e.buttons !== 1) return;
    ctx.setGoalAt(e.world);
  }

  preview(): ToolPreview { return EMPTY_PREVIEW; }
}
