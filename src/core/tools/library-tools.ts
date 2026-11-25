/**
 * `openboard.library.save | list | insert` (Req 6.14, 6.15, 6.16, 13.2). Built-in components come
 * from `core/library/builtins`; saved components live in the board document. When `ids` is omitted,
 * `save` uses the current selection from the injected `SelectionStore`.
 */
import { ComponentCycleError, ComponentDepthError, syncPass } from '../components/sync';
import { BUILTIN_COMPONENTS, findComponent } from '../library/builtins';
import { entryProblem, expandMasterClosure, isComponentEntry, primaryMaster, subtreeIds } from '../library/component-entry';
import { LIBRARY_NAME_LENGTH, inRange } from '../model/ranges';
import { rotatedBounds, unionBounds } from '../model/geometry';
import type { Element, FrameElement } from '../model';
import type { Bounds, LibraryComponent } from '../model/types';
import { createFrame } from '../shapes';
import type { Tx } from '../ops';
import { scanTokenReferences } from '../tokens/references';
import { TOKEN_CATEGORIES, type TokenCollection, type TokenValue } from '../tokens/types';
import { s } from '../schema/builder';
import { cloneElements } from './import-tools';
import type { ToolDefinition } from './registry';
import { ToolFailure } from './tool-failure';
import { DEFAULT_SCREEN, liveSelection, MAX_SELECTION, type SelectionStore } from './view-tools';

const boardProp = () => s.opt(s.string({ minLength: 1 }));

/** Records the current value of every defined Token that `elements` reference (Req 11.13). */
function recordReferencedTokens(elements: readonly Element[], tokens: TokenCollection | undefined): TokenCollection | undefined {
  if (!tokens) return undefined;
  const out: Record<string, Record<string, TokenValue>> = {};
  for (const ref of scanTokenReferences(elements)) {
    const bucket = tokens[ref.category] as Record<string, TokenValue> | undefined;
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, ref.name)) continue;
    (out[ref.category] ??= {})[ref.name] = bucket[ref.name] as TokenValue;
  }
  return Object.keys(out).length > 0 ? (out as TokenCollection) : undefined;
}

/** Adds Tokens recorded in the entry that the board lacks; existing values are kept. */
function addMissingTokens(tx: Tx, component: LibraryComponent): void {
  if (!component.tokens) return;
  for (const category of TOKEN_CATEGORIES) {
    const recorded = component.tokens[category] as Record<string, TokenValue> | undefined;
    if (!recorded) continue;
    const existing = tx.doc.tokens?.[category] as Record<string, unknown> | undefined;
    for (const [name, value] of Object.entries(recorded)) {
      if (existing && Object.prototype.hasOwnProperty.call(existing, name)) continue;
      try {
        tx.createToken(category, name, value);
      } catch (err) {
        throw new ToolFailure('invalid_token', err instanceof Error ? err.message : String(err));
      }
    }
  }
}

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
      // A chosen master brings its subtree and every master its instances depend on (Req 16.3).
      const closure = expandMasterClosure(tx.doc.elements, new Set(wanted));
      if (closure.missing.length > 0) {
        throw new ToolFailure('invalid_component', `Save failed: master not found: ${closure.missing.join(', ')}`);
      }
      const chosen = closure.ids;
      const elements: Element[] = [];
      for (const e of tx.doc.elements) {
        if (!chosen.has(e.id)) continue;
        if (e.type === 'edge' && !(chosen.has(e.sourceId) && chosen.has(e.targetId))) continue;
        const copy = structuredClone(e) as Element;
        if (copy.parentId !== undefined && !chosen.has(copy.parentId)) delete copy.parentId;
        elements.push(copy);
      }
      if (elements.length === 0) throw new ToolFailure('empty_selection', 'None of the selected elements can be saved as a component');
      const tokens = recordReferencedTokens(elements, tx.doc.tokens);
      const comp = tx.addLibraryComponent({ name: input.name, elements, ...(tokens ? { tokens } : {}) });
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
    'List library components: the built-ins (button, input field, card, navigation bar, checkbox, toggle, avatar, badge, phone, tablet, browser, device outline) followed by the components saved in the board. Read-only.',
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
    const { tx } = ctx;
    if (isComponentEntry(found.component)) {
      try {
        return { ids: insertComponentEntry(tx, found.component, input) };
      } catch (err) {
        // Req 24.9: any failure reports that the insertion failed; the failed tool call is rolled
        // back, so no master or instance remains.
        if (err instanceof ToolFailure) {
          if (err.message.startsWith('Insertion failed')) throw err;
          throw new ToolFailure(err.code, `Insertion failed: ${err.message}`);
        }
        throw new ToolFailure('insertion_failed', `Insertion failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Add missing tokens first, in the same transaction (one Undo_History entry) as the insertion.
    addMissingTokens(tx, found.component);
    return { ids: cloneElements(tx, found.component.elements, input) };
  },
};

/** Bounds of the document's content that a new master must stay clear of (edges have no box). */
function contentBounds(elements: readonly Element[]): Bounds | undefined {
  return unionBounds(elements.filter((e) => e.type !== 'edge').map((e) => rotatedBounds(e)));
}

/**
 * Inserts an entry saved from a Component_Master (Req 16.1, 16.2, 16.12, 16.13). Creates the master
 * (with the masters it depends on and its Tokens) at least 100 units from existing content unless
 * the document already has the master, then one instance at the viewport center. The entry is only
 * read; the inserted masters keep no link to it.
 */
function insertComponentEntry(tx: Tx, entry: LibraryComponent, at: { x?: number; y?: number }): string[] {
  const problem = entryProblem(entry);
  if (problem !== undefined) throw new ToolFailure('invalid_library_entry', `Insertion failed: ${problem}`);
  const primary = primaryMaster(entry) as FrameElement;
  const ids: string[] = [];

  let masterId = primary.id;
  const existing = tx.doc.elements.find((e) => e.id === primary.id);
  if (!(existing && existing.type === 'frame' && existing.component !== undefined)) {
    addMissingTokens(tx, entry);
    // Masters the document already has (same id) are shared; only the rest is cloned.
    const present = new Set<string>();
    for (const e of entry.elements) {
      const there = tx.doc.elements.find((d) => d.id === e.id);
      if (e.type === 'frame' && e.component !== undefined && there?.type === 'frame' && there.component !== undefined) {
        for (const id of subtreeIds(entry.elements, e.id)) present.add(id);
      }
    }
    const rest = entry.elements.filter((e) => e.id !== primary.id && !present.has(e.id));
    const source = [primary, ...rest];
    const taken = new Set(tx.doc.elements.map((e) => e.id));
    const keepIds = !source.some((e) => !e.id.includes('::') && taken.has(e.id));
    const content = contentBounds(tx.doc.elements);
    const origin = contentBounds(source);
    const place = content
      ? { x: content.x + content.width + 100, y: content.y }
      : origin
        ? { x: origin.x, y: origin.y }
        : {};
    const created = cloneElements(tx, source, place, undefined, { keepIds });
    masterId = created[0] as string;
    ids.push(...created);
  }

  const master = tx.doc.elements.find((e) => e.id === masterId);
  if (!master || master.type !== 'frame') throw new ToolFailure('invalid_library_entry', 'Insertion failed: the master could not be created.');
  const view = tx.doc.viewport;
  const cx = at.x !== undefined ? at.x + master.width / 2 : (DEFAULT_SCREEN.width / 2 - view.x) / view.zoom;
  const cy = at.y !== undefined ? at.y + master.height / 2 : (DEFAULT_SCREEN.height / 2 - view.y) / view.zoom;
  const { frame } = createFrame(
    { x: cx - master.width / 2, y: cy - master.height / 2, width: master.width, height: master.height },
    [],
    { name: master.component ?? 'Component' },
  );
  const instance = tx.create({ ...frame, instanceOf: master.id });
  try {
    syncPass(tx.doc);
  } catch (err) {
    if (err instanceof ComponentCycleError) throw new ToolFailure('component_cycle', err.message);
    if (err instanceof ComponentDepthError) throw new ToolFailure('component_depth', err.message);
    throw err;
  }
  ids.push(instance.id);
  return ids;
}

export function createLibraryTools(store: SelectionStore): ToolDefinition[] {
  return [createSaveTool(store), listTool, insertTool];
}
