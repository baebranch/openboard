/**
 * `openboard.undo` / `openboard.redo` (Req 13.2, 13.14). `async` board tools: they drive the model's
 * `UndoHistory` directly (no transaction, no new history entry). Both are destructive. When there is
 * nothing to undo/redo the call succeeds with `done: false`.
 */
import { UndoHistory, type BoardModel } from '../ops';
import { s } from '../schema/builder';
import type { ToolDefinition } from './registry';
import { ToolFailure } from './tool-failure';

interface HistoryOutput {
  done: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

function make(kind: 'undo' | 'redo'): ToolDefinition<{ board?: string }, HistoryOutput> {
  return {
    name: `openboard.${kind}`,
    description:
      kind === 'undo'
        ? 'Undo the most recent edit on a board. Returns done=false (and changes nothing) when there is nothing to undo. Destructive.'
        : 'Redo the most recently undone edit on a board. Returns done=false (and changes nothing) when there is nothing to redo. Destructive.',
    inputSchema: s.object({ board: s.opt(s.string({ minLength: 1 })) }),
    outputSchema: s.object({ done: s.boolean(), canUndo: s.boolean(), canRedo: s.boolean() }),
    destructive: true,
    async: true,
    boardResolution: 'required-or-active',
    handler(ctx) {
      const model: BoardModel | undefined = ctx.model;
      if (!model) throw new ToolFailure('no_board', 'No board is available for this tool');
      const history = model.history;
      if (!(history instanceof UndoHistory)) throw new ToolFailure('no_history', 'This board has no undo history');
      return model.serialQueue.run(() => {
        const done = kind === 'undo' ? history.undo(model) : history.redo(model);
        return { done, canUndo: history.canUndo(), canRedo: history.canRedo() };
      });
    },
  };
}

export const historyTools: ToolDefinition[] = [make('undo'), make('redo')];
