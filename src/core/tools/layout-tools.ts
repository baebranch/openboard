/**
 * `openboard.layout` (Req 8.8, 13.2). Auto layout of Flow_Nodes, applied in one transaction.
 * The handler is synchronous and mutates only through the transaction it is given.
 */
import { autoLayout, LAYOUT_DIRECTIONS, TOO_FEW_NODES_MESSAGE, type LayoutDirection } from '../layout';
import type { Element, FlowNodeElement, EdgeElement } from '../model';
import { s } from '../schema/builder';
import type { DefaultToolRegistry, ToolDefinition } from './registry';

class LayoutFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface LayoutInput {
  board?: string;
  /** Flow_Nodes to lay out (the selection). Defaults to every flow node on the board. */
  ids?: string[];
  direction?: LayoutDirection;
}

const layoutTool: ToolDefinition<LayoutInput, { moved: number; ids: string[]; direction: LayoutDirection }> = {
  name: 'openboard.layout',
  description:
    'Auto layout Flow_Nodes in layers with direction TB, BT, LR, or RL (default TB). Lays out the nodes in `ids`, or all flow nodes on the board when omitted, in one undoable step. Needs at least two flow nodes.',
  inputSchema: s.object({
    board: s.opt(s.string({ minLength: 1 })),
    ids: s.opt(s.array(s.string({ minLength: 1 }), { minItems: 1, maxItems: 1000 })),
    direction: s.opt(s.enum(LAYOUT_DIRECTIONS)),
  }),
  outputSchema: s.object({
    moved: s.integer({ min: 0 }),
    ids: s.array(s.string()),
    direction: s.enum(LAYOUT_DIRECTIONS),
  }),
  readOnly: false,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = ctx.tx;
    if (!tx) throw new LayoutFailure('no_board', 'No board is available for this tool');
    const direction = input.direction ?? 'TB';
    const all = tx.doc.elements;
    let nodes: FlowNodeElement[];
    if (input.ids) {
      const wanted = new Set(input.ids);
      const byId = new Map<string, Element>(all.map((e) => [e.id, e]));
      const missing = [...wanted].filter((id) => !byId.has(id));
      if (missing.length > 0) throw new LayoutFailure('not_found', `Element not found: ${missing.join(', ')}`);
      nodes = all.filter((e): e is FlowNodeElement => wanted.has(e.id) && e.type === 'flowNode');
    } else {
      nodes = all.filter((e): e is FlowNodeElement => e.type === 'flowNode');
    }
    const edges = all.filter((e): e is EdgeElement => e.type === 'edge');
    const result = autoLayout(
      nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height })),
      edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId })),
      direction,
    );
    if (!result.ok) throw new LayoutFailure('too_few_nodes', result.error.message || TOO_FEW_NODES_MESSAGE);
    for (const [id, p] of result.value) tx.update(id, { x: p.x, y: p.y });
    const ids = [...result.value.keys()];
    return { moved: ids.length, ids, direction };
  },
};

export const layoutTools: ToolDefinition[] = [layoutTool];

export function registerLayoutTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of layoutTools) registry.register(t);
}
