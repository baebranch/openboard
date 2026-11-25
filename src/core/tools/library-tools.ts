/**
 * `openboard.library.save | list | insert` (Req 6.14, 6.15, 6.16, 13.2). Built-in components come
 * from `core/library/builtins`; saved components live in the board document. When `ids` is omitted,
 * `save` uses the current selection from the injected `SelectionStore`.
 */
import { BUILTIN_COMPONENTS, findComponent } from '../library/builtins';
import { LIBRARY_NAME_LENGTH, inRange } from '../model/ranges';
import type { Element } from '../model';
import { s } from '../schema/builder';
import { cloneElements } from './import-tools';
import type { ToolDefinition } from './registry';
import { ToolFailure } from './tool-failure';
import { liveSelection, MAX_SELECTION, type SelectionStore } from './view-tools';

const boardProp = () => s.opt(s.string({ minLength: 1 }));

interface SaveInput {
  board?: string;
  name: string;
  ids?: string[];
}

function createSaveTool(store: SelectionStore): ToolDefinition<SaveInput, { id: string; name: string; count: number }> {
  return {
    name: 'openboard.library.save',
    description:
      'Save elements as a reusable library component in the board. `name` is 1 to 100 characters; `ids` lists the elements (default: the current selection, which must not be empty). Edges are kept only when both ends are included.',
    inputSchema: s.object({
      board: boardProp(),
      name: s.string({ minLength: 1, maxLength: LIBRARY_NAME_LENGTH.max }),
      ids: s.opt(s.array(s.string({ minLength: 1 }), { minItems: 1, maxItems: MAX_SELECTION })),
    }),
    outputSchema: s.object({ id: s.string(), name: s.string(), count: s.integer({ min: 1 }) }),
    boardResolution: 'required-or-active',
    handler(ctx, input) {
      const { tx, model } = ctx;
      if (!tx || !model) throw new ToolFailure('no_board', 'No board is available for this tool');
      if (!inRange(input.name.length, LIBRARY_NAME_LENGTH)) {
        throw new ToolFailure('invalid_name', `Component name must be ${LIBRARY_NAME_LENGTH.min} to ${LIBRARY_NAME_LENGTH.max} characters`);
      }
      const wanted = input.ids ?? liveSelection(store, model);
      if (wanted.length === 0) throw new ToolFailure('empty_selection', 'Select at least one element (or pass `ids`) to save a component');
      const byId = new Map(tx.doc.elements.map((e) => [e.id, e]));
      const missing = wanted.filter((id) => !byId.has(id));
      if (missing.length > 0) throw new ToolFailure('not_found', `Element not found: ${[...new Set(missing)].join(', ')}`);
      const chosen = new Set(wanted);
      const elements: Element[] = [];
      for (const e of tx.doc.elements) {
        if (!chosen.has(e.id)) continue;
        if (e.type === 'edge' && !(chosen.has(e.sourceId) && chosen.has(e.targetId))) continue;
        const copy = structuredClone(e) as Element;
        if (copy.parentId !== undefined && !chosen.has(copy.parentId)) delete copy.parentId;
        elements.push(copy);
      }
      if (elements.length === 0) throw new ToolFailure('empty_selection', 'None of the selected elements can be saved as a component');
      const comp = tx.addLibraryComponent({ name: input.name, elements });
      return { id: comp.id, name: comp.name, count: elements.length };
    },
  };
}

interface ListOutput {
  components: Array<{ id: string; name: string; builtin: boolean; elementCount: number }>;
}

const listTool: ToolDefinition<{ board?: string }, ListOutput> = {
  name: 'openboard.library.list',
  description:
    'List library components: the built-ins (button, input field, card, navigation bar, device outline) followed by the components saved in the board. Read-only.',
  inputSchema: s.object({ board: boardProp() }),
  outputSchema: s.object({
    components: s.array(
      s.object({ id: s.string(), name: s.string(), builtin: s.boolean(), elementCount: s.integer({ min: 0 }) }),
    ),
  }),
  readOnly: true,
  async: true,
  boardResolution: 'required-or-active',
  handler(ctx) {
    if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
    const saved = ctx.model.getDocument().library;
    return {
      components: [...BUILTIN_COMPONENTS, ...saved].map((c) => ({
        id: c.id,
        name: c.name,
        builtin: c.builtin === true,
        elementCount: c.elements.length,
      })),
    };
  },
};

interface InsertInput {
  board?: string;
  component: string;
  x?: number;
  y?: number;
}

const insertTool: ToolDefinition<InsertInput, { ids: string[] }> = {
  name: 'openboard.library.insert',
  description:
    'Insert a library component (built-in or saved; by id or name) into the board with new element ids. Optional `x`, `y` place its top-left corner.',
  inputSchema: s.object({
    board: boardProp(),
    component: s.string({ minLength: 1 }),
    x: s.opt(s.number()),
    y: s.opt(s.number()),
  }),
  outputSchema: s.object({ ids: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    if (!ctx.tx) throw new ToolFailure('no_board', 'No board is available for this tool');
    const found = findComponent(ctx.tx.doc.library, input.component);
    if (!found.component) throw new ToolFailure(found.error!.code, found.error!.message);
    return { ids: cloneElements(ctx.tx, found.component.elements, input) };
  },
};

export function createLibraryTools(store: SelectionStore): ToolDefinition[] {
  return [createSaveTool(store), listTool, insertTool];
}
