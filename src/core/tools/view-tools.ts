/**
 * `openboard.board.summary`, `openboard.selection`, `openboard.viewport` (Req 13.2, 13.14).
 * All three are `async` board tools: they read `ctx.model` and open no transaction, so none of them
 * creates a history entry. Selection is per-window UI state held in an injected `SelectionStore`;
 * viewport changes are applied without history.
 */
import { ELEMENT_TYPES, type Bounds, type Element, type Viewport } from '../model';
import { unionBounds } from '../model/geometry';
import { COORD_RANGE, ZOOM_RANGE, clamp } from '../model/ranges';
import type { BoardModel } from '../ops';
import { s } from '../schema/builder';
import { pan, zoomToFit, zoomToSelection, type Size } from '../viewport';
import type { ToolContext, ToolDefinition } from './registry';
import { ToolFailure } from './tool-failure';

/** Host-session selection state, keyed by board path. */
export interface SelectionStore {
  get(boardPath: string): string[];
  set(boardPath: string, ids: string[]): void;
}

/** Simple in-memory store (default for hosts without UI state, and for tests). */
export class MemorySelectionStore implements SelectionStore {
  private readonly map = new Map<string, string[]>();
  get(boardPath: string): string[] {
    return [...(this.map.get(boardPath) ?? [])];
  }
  set(boardPath: string, ids: string[]): void {
    this.map.set(boardPath, [...ids]);
  }
}

export const SUMMARY_ID_SAMPLE = 20;
export const MAX_SELECTION = 1000;
export const DEFAULT_SCREEN: Size = { width: 1280, height: 800 };

function needModel(ctx: ToolContext): BoardModel {
  if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
  return ctx.model;
}

const boardProp = () => s.opt(s.string({ minLength: 1 }));

/** Selection ids that still exist on the board, in selection order. */
export function liveSelection(store: SelectionStore, model: BoardModel): string[] {
  const known = new Set(model.getDocument().elements.map((e) => e.id));
  return store.get(model.path).filter((id) => known.has(id));
}

// --- summary ------------------------------------------------------------------------------------

interface SummaryOutput {
  title?: string;
  total: number;
  counts: Record<string, number>;
  bounds?: Bounds;
  viewport: { x: number; y: number; zoom: number };
  ids: string[];
  assets: number;
  library: number;
}

const summaryTool: ToolDefinition<{ board?: string }, SummaryOutput> = {
  name: 'openboard.board.summary',
  description:
    'Summarise a board: element counts by type, content bounds, the current viewport, and a sample of element ids (first 20 in z-order). Read-only.',
  inputSchema: s.object({ board: boardProp() }),
  outputSchema: s.object({
    title: s.opt(s.string()),
    total: s.integer({ min: 0 }),
    counts: s.object({}),
    bounds: s.opt(s.object({ x: s.number(), y: s.number(), width: s.number(), height: s.number() })),
    viewport: s.object({ x: s.number(), y: s.number(), zoom: s.number() }),
    ids: s.array(s.string()),
    assets: s.integer({ min: 0 }),
    library: s.integer({ min: 0 }),
  }),
  readOnly: true,
  async: true,
  boardResolution: 'required-or-active',
  handler(ctx) {
    const doc = needModel(ctx).getDocument();
    const counts: Record<string, number> = {};
    for (const t of ELEMENT_TYPES) counts[t] = 0;
    for (const e of doc.elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const bounds = unionBounds(doc.elements.filter((e) => e.type !== 'edge'));
    const out: SummaryOutput = {
      total: doc.elements.length,
      counts,
      viewport: { x: doc.viewport.x, y: doc.viewport.y, zoom: doc.viewport.zoom },
      ids: doc.elements.slice(0, SUMMARY_ID_SAMPLE).map((e) => e.id),
      assets: doc.assets.length,
      library: doc.library.length,
    };
    if (doc.meta.title !== undefined) out.title = doc.meta.title;
    if (bounds) out.bounds = bounds;
    return out;
  },
};

// --- selection ----------------------------------------------------------------------------------

interface SelectionInput {
  board?: string;
  action?: 'get' | 'set';
  ids?: string[];
}

function createSelectionTool(store: SelectionStore): ToolDefinition<SelectionInput, { ids: string[] }> {
  return {
    name: 'openboard.selection',
    description:
      'Get or set the current selection of a board. `action` "get" (default) returns the selected ids; "set" replaces the selection with `ids` (up to 1000, an empty list clears it). Unknown ids fail with not_found.',
    inputSchema: s.object({
      board: boardProp(),
      action: s.opt(s.enum(['get', 'set'])),
      ids: s.opt(s.array(s.string({ minLength: 1 }), { maxItems: MAX_SELECTION })),
    }),
    outputSchema: s.object({ ids: s.array(s.string()) }),
    async: true,
    boardResolution: 'required-or-active',
    handler(ctx, input) {
      const model = needModel(ctx);
      if ((input.action ?? 'get') === 'get') return { ids: liveSelection(store, model) };
      if (input.ids === undefined) throw new ToolFailure('invalid_input', '"ids" is required for action "set"');
      const known = new Set(model.getDocument().elements.map((e) => e.id));
      const missing = input.ids.filter((id) => !known.has(id));
      if (missing.length > 0) throw new ToolFailure('not_found', `Element not found: ${[...new Set(missing)].join(', ')}`);
      const ids = [...new Set(input.ids)];
      store.set(model.path, ids);
      return { ids };
    },
  };
}

// --- viewport -----------------------------------------------------------------------------------

export const VIEWPORT_ACTIONS = ['set', 'zoomToFit', 'zoomToSelection', 'pan'] as const;

interface ViewportInput {
  board?: string;
  action: (typeof VIEWPORT_ACTIONS)[number];
  x?: number;
  y?: number;
  zoom?: number;
  dx?: number;
  dy?: number;
  /** Visible screen size in pixels for the fit actions (default 1280 x 800). */
  screen?: Size;
}

const clampCoord = (n: number): number => clamp(n, COORD_RANGE);

function createViewportTool(store: SelectionStore): ToolDefinition<ViewportInput, { viewport: Viewport; changed: boolean }> {
  return {
    name: 'openboard.viewport',
    description:
      'Change the board viewport (not recorded in undo history). `action` "set" takes x, y and/or zoom (2%..800% = 0.02..8); "pan" takes dx, dy; "zoomToFit" fits all content; "zoomToSelection" fits `selection` (the current selection). The fit actions take an optional `screen` {width, height} in pixels (default 1280x800) and leave the viewport unchanged when there is nothing to fit.',
    inputSchema: s.object({
      board: boardProp(),
      action: s.enum(VIEWPORT_ACTIONS),
      x: s.opt(s.number({ min: COORD_RANGE.min, max: COORD_RANGE.max })),
      y: s.opt(s.number({ min: COORD_RANGE.min, max: COORD_RANGE.max })),
      zoom: s.opt(s.number({ min: ZOOM_RANGE.min, max: ZOOM_RANGE.max })),
      dx: s.opt(s.number({ min: -2 * COORD_RANGE.max, max: 2 * COORD_RANGE.max })),
      dy: s.opt(s.number({ min: -2 * COORD_RANGE.max, max: 2 * COORD_RANGE.max })),
      screen: s.opt(s.object({ width: s.number({ min: 1 }), height: s.number({ min: 1 }) })),
    }),
    outputSchema: s.object({
      viewport: s.object({ x: s.number(), y: s.number(), zoom: s.number() }),
      changed: s.boolean(),
    }),
    async: true,
    boardResolution: 'required-or-active',
    handler(ctx, input) {
      const model = needModel(ctx);
      const current = model.getDocument().viewport;
      const screen = input.screen ?? DEFAULT_SCREEN;
      let next: Viewport;
      switch (input.action) {
        case 'set':
          if (input.x === undefined && input.y === undefined && input.zoom === undefined) {
            throw new ToolFailure('invalid_input', 'action "set" needs at least one of x, y, zoom');
          }
          next = { x: input.x ?? current.x, y: input.y ?? current.y, zoom: input.zoom ?? current.zoom };
          break;
        case 'pan':
          if (input.dx === undefined && input.dy === undefined) {
            throw new ToolFailure('invalid_input', 'action "pan" needs dx and/or dy');
          }
          next = pan(current, input.dx ?? 0, input.dy ?? 0);
          break;
        case 'zoomToFit':
          next = zoomToFit(current, model.getDocument().elements.filter(isBoxed), screen);
          break;
        case 'zoomToSelection': {
          const ids = new Set(liveSelection(store, model));
          next = zoomToSelection(current, model.getDocument().elements.filter((e) => ids.has(e.id) && isBoxed(e)), screen);
          break;
        }
      }
      const viewport: Viewport = { x: clampCoord(next.x), y: clampCoord(next.y), zoom: next.zoom };
      const changed = viewport.x !== current.x || viewport.y !== current.y || viewport.zoom !== current.zoom;
      if (!changed) return { viewport, changed };
      // Viewport is view state: applied without a history entry (Req 3, 13.14).
      return model.serialQueue
        .run(() => model.apply({ patches: [{ op: 'replace', path: ['viewport'], value: viewport }] }))
        .then(() => ({ viewport, changed }));
    },
  };
}

/** Edges carry no geometry of their own; they do not contribute to fit bounds. */
function isBoxed(e: Element): boolean {
  return e.type !== 'edge';
}

export function createViewTools(store: SelectionStore): ToolDefinition[] {
  return [summaryTool, createSelectionTool(store), createViewportTool(store)];
}
