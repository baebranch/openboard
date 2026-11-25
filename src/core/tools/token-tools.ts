/**
 * `openboard.token.create | update | rename | delete | list | detach` (Req 11.7, 11.8, 11.10, 11.11,
 * 11.17, 11.18, 25.2). Every handler runs inside the transaction the registry opens, so each call
 * is one undo entry and a rejected call leaves the document unchanged.
 */
import type { Element } from '../model';
import { s } from '../schema/builder';
import {
  DETACH_FALLBACK,
  TOKEN_CATEGORIES,
  countTokenReferences,
  detachTokenReferences,
  renameTokenReferences,
  scanTokenReferences,
  validateNewToken,
  validateTokenName,
  validateTokenValue,
  type TokenCategory,
  type TokenCollection,
  type TokenValue,
  type ActiveMode,
  ACTIVE_MODES,
  resolveMode,
} from '../tokens';
import type { DefaultToolRegistry, ToolDefinition } from './registry';
import { ToolFailure } from './tool-failure';
import type { ElementPatch, Tx } from '../ops/model';
import type { LibraryComponent } from '../model/types';

const boardProp = () => s.opt(s.string({ minLength: 1 }));
const categorySchema = () => s.enum(TOKEN_CATEGORIES);
const valueSchema = () => ({ oneOf: [s.string(), s.number(), s.object({ light: s.string(), dark: s.string() }, { additionalProperties: false })] });



function requireTx(tx: Tx | undefined): Tx {
  if (!tx) throw new ToolFailure('no_board', 'No board is available for this tool');
  return tx;
}

function bucketOf(tokens: TokenCollection | undefined, category: TokenCategory): Record<string, TokenValue> {
  return (tokens?.[category] ?? {}) as Record<string, TokenValue>;
}

function hasToken(tokens: TokenCollection | undefined, category: TokenCategory, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(bucketOf(tokens, category), name);
}

function requireToken(tx: Tx, category: TokenCategory, name: string): void {
  if (!hasToken(tx.doc.tokens, category, name)) {
    throw new ToolFailure('not_found', `${category} Token not found: ${name}`);
  }
}

function fail(check: { code: string; message: string }): never {
  throw new ToolFailure(check.code, check.message);
}

/** Total Token_References to one token across Elements, Overrides, and Library entries. */
function totalReferences(tx: Tx, category: TokenCategory, name: string): number {
  let n = 0;
  for (const el of tx.doc.elements) n += countTokenReferences(el, category, name);
  for (const c of tx.doc.library) n += countTokenReferences(c, category, name);
  return n;
}

/** Builds the update patch that turns `before` into `after` (changed top-level keys only). */
function diffPatch(before: Element, after: Element): ElementPatch {
  const patch: Record<string, unknown> = {};
  const a = after as unknown as Record<string, unknown>;
  const b = before as unknown as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    if (key === 'id' || key === 'type') continue;
    if (a[key] !== b[key]) patch[key] = a[key];
  }
  return patch as ElementPatch;
}

/** Applies `rewrite` to the given elements and to every Library entry; returns the elements changed. */
function rewriteReferences(
  tx: Tx,
  rewrite: <T>(value: T) => T,
  elementIds?: ReadonlySet<string>,
): { elements: string[]; library: number } {
  const changed: string[] = [];
  for (const el of tx.doc.elements) {
    if (elementIds && !elementIds.has(el.id)) continue;
    const next = rewrite(el);
    if (next === el) continue;
    tx.update(el.id, diffPatch(el, next));
    changed.push(el.id);
  }
  let library = 0;
  if (!elementIds) {
    const before = tx.doc.library;
    const next = before.map((c) => rewrite(c));
    const first = next.findIndex((c, i) => c !== before[i]);
    if (first >= 0) {
      // Library has no in-place update; remove from the first changed entry on and re-add in order.
      const tail: LibraryComponent[] = next.slice(first);
      for (const c of before.slice(first)) tx.removeLibraryComponent(c.id);
      for (const c of tail) tx.addLibraryComponent(c);
      library = next.filter((c, i) => c !== before[i]).length;
    }
  }
  return { elements: changed, library };
}

// --- create / update ---------------------------------------------------------------------------

interface SetInput {
  board?: string;
  category: TokenCategory;
  name: string;
  value: TokenValue;
}

interface SetOutput {
  category: TokenCategory;
  name: string;
  value: TokenValue;
}

const createTool: ToolDefinition<SetInput, SetOutput> = {
  name: 'openboard.token.create',
  description:
    'Create a design token. `category` is colors, fonts, or numbers; `name` is 1 to 64 characters from letters, digits, hyphen, underscore, period; `value` is a literal (a color, a font family string, or a number), never a `token:` reference; a colors token may instead be `{ light, dark }` to hold one color per mode. Reference it from a color field or fontFamily as `token:<name>`; a numbers token can be referenced from a layout gap or padding side.',
  inputSchema: s.object({
    board: boardProp(),
    category: categorySchema(),
    name: s.string(),
    value: valueSchema(),
  }),
  outputSchema: s.object({ category: categorySchema(), name: s.string(), value: valueSchema() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const check = validateNewToken(tx.doc.tokens, input.category, input.name, input.value);
    if (!check.ok) fail(check);
    tx.createToken(input.category, check.value.name, check.value.value);
    return { category: input.category, name: check.value.name, value: check.value.value };
  },
};

const updateTool: ToolDefinition<SetInput, SetOutput> = {
  name: 'openboard.token.update',
  description:
    'Change the value of an existing design token. Every element that references it follows the new value in one undo step. The value must be a literal for the category (a colors token may be `{ light, dark }`), not a `token:` reference.',
  inputSchema: s.object({
    board: boardProp(),
    category: categorySchema(),
    name: s.string(),
    value: valueSchema(),
  }),
  outputSchema: s.object({ category: categorySchema(), name: s.string(), value: valueSchema() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    requireToken(tx, input.category, input.name);
    const check = validateTokenValue(input.category, input.value);
    if (!check.ok) fail(check);
    tx.updateToken(input.category, input.name, check.value);
    return { category: input.category, name: input.name, value: check.value };
  },
};

// --- rename ------------------------------------------------------------------------------------

interface RenameInput {
  board?: string;
  category: TokenCategory;
  name: string;
  newName: string;
}

interface RenameOutput {
  category: TokenCategory;
  name: string;
  newName: string;
  /** Elements whose references were rewritten. */
  elements: number;
  /** Library entries whose references were rewritten. */
  library: number;
}

const renameTool: ToolDefinition<RenameInput, RenameOutput> = {
  name: 'openboard.token.rename',
  description:
    'Rename a design token to a valid, unused name in the same category. Every `token:` reference in elements, overrides, and library entries is rewritten in the same undo step.',
  inputSchema: s.object({
    board: boardProp(),
    category: categorySchema(),
    name: s.string(),
    newName: s.string(),
  }),
  outputSchema: s.object({
    category: categorySchema(),
    name: s.string(),
    newName: s.string(),
    elements: s.integer({ min: 0 }),
    library: s.integer({ min: 0 }),
  }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    requireToken(tx, input.category, input.name);
    const n = validateTokenName(input.newName);
    if (!n.ok) fail(n);
    if (input.newName !== input.name && hasToken(tx.doc.tokens, input.category, input.newName)) {
      throw new ToolFailure('duplicate_name', `A ${input.category} Token named "${input.newName}" already exists.`);
    }
    if (input.newName === input.name) return { ...input, elements: 0, library: 0 };
    tx.renameToken(input.category, input.name, input.newName);
    const changed = rewriteReferences(tx, (v) => renameTokenReferences(v, input.category, input.name, input.newName));
    return { ...input, elements: changed.elements.length, library: changed.library };
  },
};

// --- delete ------------------------------------------------------------------------------------

interface DeleteInput {
  board?: string;
  category: TokenCategory;
  name: string;
}

const deleteTool: ToolDefinition<DeleteInput, { category: TokenCategory; name: string }> = {
  name: 'openboard.token.delete',
  description:
    'Delete a design token. Rejected with the reference count while any element, override, or library entry still references it; detach or change those references first.',
  inputSchema: s.object({ board: boardProp(), category: categorySchema(), name: s.string() }),
  outputSchema: s.object({ category: categorySchema(), name: s.string() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    requireToken(tx, input.category, input.name);
    const refs = totalReferences(tx, input.category, input.name);
    if (refs > 0) {
      throw new ToolFailure(
        'token_in_use',
        `Cannot delete ${input.category} Token "${input.name}": it has ${refs} reference${refs === 1 ? '' : 's'}.`,
      );
    }
    tx.deleteToken(input.category, input.name);
    return { category: input.category, name: input.name };
  },
};

// --- list --------------------------------------------------------------------------------------

interface ListInput {
  board?: string;
  category?: TokenCategory;
}

interface TokenInfo {
  category: TokenCategory;
  name: string;
  value: TokenValue;
  references: number;
}

const listTool: ToolDefinition<ListInput, { tokens: TokenInfo[] }> = {
  name: 'openboard.token.list',
  description:
    'List design tokens with their values and reference counts, optionally for one category. Read-only.',
  inputSchema: s.object({ board: boardProp(), category: s.opt(categorySchema()) }),
  outputSchema: s.object({
    tokens: s.array(
      s.object({
        category: categorySchema(),
        name: s.string(),
        value: valueSchema(),
        references: s.integer({ min: 0 }),
      }),
    ),
  }),
  readOnly: true,
  async: true,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
    const doc = ctx.model.getDocument();
    const counts = new Map<string, number>();
    const tally = (value: unknown): void => {
      for (const o of scanTokenReferences(value)) {
        const key = `${o.category}\0${o.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    };
    for (const el of doc.elements) tally(el);
    for (const c of doc.library) tally(c);
    const tokens: TokenInfo[] = [];
    for (const category of TOKEN_CATEGORIES) {
      if (input.category && input.category !== category) continue;
      for (const [name, value] of Object.entries(bucketOf(doc.tokens, category))) {
        tokens.push({ category, name, value, references: counts.get(`${category}\0${name}`) ?? 0 });
      }
    }
    return { tokens };
  },
};

// --- detach ------------------------------------------------------------------------------------

interface DetachInput {
  board?: string;
  ids?: string[];
  category?: TokenCategory;
  name?: string;
}

const detachTool: ToolDefinition<DetachInput, { ids: string[] }> = {
  name: 'openboard.token.detach',
  description:
    'Replace `token:` references with their resolved literal values (the default color or font family, or 0 for a layout gap or padding, when the token is missing). `ids` limits it to those elements (default: every element); `category` with `name` limits it to one token. One undo step.',
  inputSchema: s.object({
    board: boardProp(),
    ids: s.opt(s.array(s.string({ minLength: 1 }), { minItems: 1, maxItems: 1000 })),
    category: s.opt(categorySchema()),
    name: s.opt(s.string()),
  }),
  outputSchema: s.object({ ids: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    if ((input.category === undefined) !== (input.name === undefined)) {
      throw new ToolFailure('invalid_input', '`category` and `name` must be given together');
    }
    let scope: Set<string> | undefined;
    if (input.ids) {
      scope = new Set(input.ids);
      const known = new Set(tx.doc.elements.map((e) => e.id));
      const missing = [...scope].filter((id) => !known.has(id));
      if (missing.length > 0) throw new ToolFailure('not_found', `Element not found: ${missing.join(', ')}`);
    }
    const only = input.category !== undefined && input.name !== undefined ? { category: input.category, name: input.name } : undefined;
    const tokens = tx.doc.tokens;
    // A two-valued color detaches to the stored mode's value; `auto` has no theme kind here, so light.
    const mode = resolveMode(tx.doc.settings?.activeMode);
    const changed = rewriteReferences(
      tx,
      (v) => detachTokenReferences(v, tokens, { ...(only ? { only } : {}), fallback: DETACH_FALLBACK, mode }),
      scope ?? new Set(tx.doc.elements.map((e) => e.id)),
    );
    return { ids: changed.elements };
  },
};

// --- mode --------------------------------------------------------------------------------------

interface ModeInput {
  board?: string;
  mode: ActiveMode;
}

const modeTool: ToolDefinition<ModeInput, { mode: ActiveMode }> = {
  name: 'openboard.token.mode',
  description:
    'Set the board token mode: `light`, `dark`, or `auto` (follow the IDE theme). Colors tokens that hold `{ light, dark }` render the value for the resolved mode. One undo step; the board stores the mode.',
  inputSchema: s.object({ board: boardProp(), mode: s.enum(ACTIVE_MODES) }),
  outputSchema: s.object({ mode: s.enum(ACTIVE_MODES) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const current = tx.doc.settings;
    if ((current?.activeMode ?? 'auto') === input.mode) return { mode: input.mode };
    tx.setSettings({ ...current, activeMode: input.mode });
    return { mode: input.mode };
  },
};

export const tokenTools: ToolDefinition[] = [
  createTool as ToolDefinition,
  updateTool as ToolDefinition,
  renameTool as ToolDefinition,
  deleteTool as ToolDefinition,
  listTool as ToolDefinition,
  detachTool as ToolDefinition,
  modeTool as ToolDefinition,
];

export function registerTokenTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of tokenTools) registry.register(t);
}
