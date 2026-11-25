/**
 * The `ob` API of code mode: the guest prelude (runs inside the sandbox), the host dispatcher that
 * turns `ob` calls into registry tool calls, and the TypeScript declarations shown to agents.
 * Pure: no node or vscode imports, shared by the MCP server and the VS Code LM tools.
 */
import { elementDocs, propLines, type ElementDocs } from './element-docs';
import type { HostCallResult } from './sandbox';

export const TOOL_PREFIX = 'openboard.';

// --- guest prelude ------------------------------------------------------------------------------

/**
 * Runs once in the sandbox before the script. Captures the two host functions and removes them
 * from the global object, defines `console` and a frozen `ob`. Everything else lives host-side.
 */
export const GUEST_PRELUDE = `(function () {
  var hostCall = globalThis.__ob_call;
  var hostLog = globalThis.__ob_log;
  delete globalThis.__ob_call;
  delete globalThis.__ob_log;
  async function call(method, args) {
    var res = JSON.parse(await hostCall(method, JSON.stringify(args)));
    if (res.ok) return res.value;
    var msg = '[' + res.error.code + '] ' + res.error.message;
    if (res.error.issues !== undefined) {
      try { msg += ' ' + JSON.stringify(res.error.issues).slice(0, 1500); } catch (e) {}
    }
    var err = new Error(msg);
    err.name = 'OpenBoardError';
    err.code = res.error.code;
    if (res.error.issues !== undefined) err.issues = res.error.issues;
    throw err;
  }
  function fmt(v) {
    if (typeof v === 'string') return v;
    try { var s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); }
  }
  function logger(level) { return function () { hostLog(level, Array.prototype.map.call(arguments, fmt).join(' ')); }; }
  Object.defineProperty(globalThis, 'console', {
    value: Object.freeze({ log: logger('log'), info: logger('log'), debug: logger('log'), warn: logger('warn'), error: logger('error') }),
    writable: false, configurable: false,
  });
  function board(path) {
    return Object.freeze({
      path: path,
      summary: function () { return call('summary', [path]); },
      query: function (q) { return call('query', [path, q]); },
      get: function (id) { return call('get', [path, id]); },
      create: function (els) { return call('create', [path, els]); },
      update: function (ids, set) { return call('update', [path, ids, set]); },
      remove: function (ids) { return call('remove', [path, ids]); },
      arrange: function (action, opts) { return call('arrange', [path, action, opts]); },
      connect: function (a, b, c) { return call('connect', [path, a, b, c]); },
      layout: function (opts) { return call('layout', [path, opts]); },
      importMermaid: function (text, opts) { return call('importMermaid', [path, text, opts]); },
      library: function () { return call('library', [path]); },
      insertComponent: function (c, opts) { return call('insertComponent', [path, c, opts]); },
      viewport: function (opts) { return call('viewport', [path, opts]); },
      export: function (opts) { return call('export', [path, opts]); },
      save: function () { return call('save', [path]); },
    });
  }
  Object.defineProperty(globalThis, 'ob', {
    value: Object.freeze({
      boards: function () { return call('boards', []); },
      board: function (path) { return board(path); },
      call: function (tool, input) { return call('call', [tool, input]); },
    }),
    writable: false, configurable: false,
  });
})();`;

// --- host dispatcher ----------------------------------------------------------------------------

/** One registry invocation; resolves to the registry result (which may be `{ error }`). */
export type InvokeTool = (name: string, input: unknown) => Promise<unknown>;

class ObError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `{ error: { code, message, issues? } }` shape, or a failed batch `{ ok: false, error: { reason } }`. */
export function toolError(result: unknown): { code: string; message: string; issues?: unknown } | undefined {
  if (!isObj(result) || !isObj(result.error)) return undefined;
  const e = result.error;
  if (result.ok === false) {
    const where = typeof e.index === 'number' ? ` (operation ${e.index})` : '';
    return { code: 'batch_failed', message: `${String(e.reason ?? 'batch failed')}${where}`, ...(e.issues ? { issues: e.issues } : {}) };
  }
  return {
    code: typeof e.code === 'string' ? e.code : 'error',
    message: typeof e.message === 'string' ? e.message : '',
    ...(e.issues ? { issues: e.issues } : {}),
  };
}

export function toolName(action: string): string {
  return action.startsWith(TOOL_PREFIX) ? action : `${TOOL_PREFIX}${action}`;
}

function asIds(v: unknown, what: string): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  throw new ObError('invalid_input', `${what} must be a string or an array of strings`);
}

const optObj = (v: unknown, what: string): Record<string, unknown> => {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) throw new ObError('invalid_input', `${what} must be an object`);
  return v;
};

export interface DispatcherOptions {
  invoke: InvokeTool;
  /** Board used by `ob.board()` with no path and by `ob.call` without `board`. Active board when absent. */
  defaultBoard?: string;
}

/** Builds the host side of `ob`: `(method, args) => HostCallResult`. Never rejects. */
export function createDispatcher(options: DispatcherOptions): (method: string, args: unknown[]) => Promise<HostCallResult> {
  const run = async (tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const result = await options.invoke(toolName(tool), input);
    const err = toolError(result);
    if (err) throw new ObError(err.code, err.message, err.issues);
    return isObj(result) ? result : { value: result };
  };
  const on = (path: unknown): Record<string, unknown> => {
    const board = path ?? options.defaultBoard;
    if (board === undefined || board === null) return {};
    if (typeof board !== 'string' || board.length === 0) throw new ObError('invalid_input', 'board path must be a non-empty string');
    return { board };
  };

  const methods: Record<string, (a: unknown[]) => Promise<unknown>> = {
    boards: () => run('board.list', {}),
    summary: ([p]) => run('board.summary', on(p)),
    query: ([p, q]) => run('element.query', { ...on(p), ...optObj(q, 'query') }),
    async get([p, id]) {
      if (typeof id !== 'string') throw new ObError('invalid_input', 'get(id): id must be a string');
      const r = await run('element.query', { ...on(p), ids: [id] });
      return (r.items as unknown[] | undefined)?.[0] ?? null;
    },
    async create([p, els]) {
      const elements = Array.isArray(els) ? els : [els];
      const r = await run('element.create', { ...on(p), elements });
      return r.ids;
    },
    update: ([p, ids, set]) => run('element.update', { ...on(p), ids: asIds(ids, 'ids'), set: optObj(set, 'set') }),
    remove: ([p, ids]) => run('element.delete', { ...on(p), ids: asIds(ids, 'ids') }),
    arrange([p, action, opts]) {
      if (typeof action !== 'string') throw new ObError('invalid_input', 'arrange(action, opts): action must be a string');
      return run('element.arrange', { ...on(p), ...optObj(opts, 'opts'), action });
    },
    connect([p, a, b, c]) {
      let edges: unknown[];
      if (Array.isArray(a)) edges = a;
      else if (isObj(a)) edges = [a];
      else if (typeof a === 'string') {
        const hasTarget = typeof b === 'string';
        edges = [{ sourceId: a, ...(hasTarget ? { targetId: b } : {}), ...optObj(hasTarget ? c : b, 'opts') }];
      } else throw new ObError('invalid_input', 'connect(edges) or connect(sourceId, targetId, opts)');
      return run('connect', { ...on(p), edges });
    },
    layout: ([p, opts]) => run('layout', { ...on(p), ...optObj(opts, 'opts') }),
    importMermaid([p, text, opts]) {
      if (typeof text !== 'string') throw new ObError('invalid_input', 'importMermaid(text): text must be a string');
      return run('import', { ...on(p), ...optObj(opts, 'opts'), source: 'mermaid', text });
    },
    library: ([p]) => run('library.list', on(p)),
    insertComponent([p, c, opts]) {
      if (typeof c !== 'string') throw new ObError('invalid_input', 'insertComponent(idOrName): must be a string');
      return run('library.insert', { ...on(p), ...optObj(opts, 'opts'), component: c });
    },
    viewport: ([p, opts]) => run('viewport', { ...on(p), ...optObj(opts, 'opts') }),
    export: ([p, opts]) => run('export', { ...on(p), ...optObj(opts, 'opts') }),
    save: ([p]) => run('board.save', on(p)),
    call([tool, input]) {
      if (typeof tool !== 'string' || tool.length === 0) throw new ObError('invalid_input', 'call(tool, input): tool must be a string');
      const body = optObj(input, 'input');
      const board = options.defaultBoard !== undefined && body.board === undefined ? { board: options.defaultBoard } : {};
      return run(tool, { ...board, ...body });
    },
  };

  return async (method, args) => {
    const fn = Object.hasOwn(methods, method) ? methods[method] : undefined;
    if (!fn) return { ok: false, error: { code: 'unknown_method', message: `ob has no method "${method}"` } };
    try {
      const value = await fn(args);
      return { ok: true, value: value === undefined ? null : value };
    } catch (e) {
      if (e instanceof ObError) {
        return { ok: false, error: { code: e.code, message: e.message, ...(e.issues !== undefined ? { issues: e.issues } : {}) } };
      }
      return { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } };
    }
  };
}

// --- declarations -------------------------------------------------------------------------------

interface Describer {
  describe(name: string): { inputSchema: unknown };
}

/** TypeScript declarations of the sandbox globals (`ob`, `console`), generated from the registry. */
export function buildObDeclarations(registry: Describer, actionNames: string[]): string {
  const docs: ElementDocs = elementDocs(registry);
  const types = docs.types.map((t) => JSON.stringify(t)).join(' | ');
  const common = propLines(docs.common);
  const actions = actionNames.map((a) => JSON.stringify(a)).join(' | ');
  return `type ElementType = ${types};
/** Properties shared by all element types; type-specific ones are listed in the \`elements\` topic. Unlisted keys are rejected by the tool. */
interface ElementInput {
  type: ElementType | (string & {});
${common}
  /** Type-specific properties (text, runs, points, sourceId, targetId, preset, ...). */
  [property: string]: unknown;
}
interface ElementSelector { ids?: string[]; type?: ElementType; filter?: Record<string, unknown>; }
interface QueryOptions extends ElementSelector { limit?: number; offset?: number; cursor?: string; }
interface Page<T> { items: T[]; total: number; offset: number; nextOffset?: number; nextCursor?: string; }
interface Element { id: string; type: ElementType; x: number; y: number; width: number; height: number; style: Record<string, unknown>; [property: string]: unknown; }
interface EdgeSpec { sourceId: string; targetId?: string; toPosition?: { x: number; y: number }; routing?: "straight" | "curved" | "orthogonal"; sourceArrow?: string; targetArrow?: string; strokeStyle?: "solid" | "dashed" | "dotted"; label?: string; }

interface BoardHandle {
  /** Absolute path of the board, or undefined for the active board. */
  readonly path: string | undefined;
  summary(): Promise<{ counts: Record<string, number>; [k: string]: unknown }>;
  query(filter?: QueryOptions): Promise<Page<Element>>;
  /** The element, or null when there is no such id. */
  get(id: string): Promise<Element | null>;
  /** Creates elements (a single element or an array). Resolves to their ids in order. */
  create(elements: ElementInput | ElementInput[]): Promise<string[]>;
  /** Applies the same \`set\` (flat property names, e.g. { x: 10, fill: "#ff0000" }) to every id. */
  update(ids: string | string[], set: Record<string, unknown>): Promise<{ updated: number; ids: string[] }>;
  /** Deletes elements; attached edges go too (listed in \`cascaded\`). */
  remove(ids: string | string[]): Promise<{ deleted: string[]; cascaded: string[] }>;
  /** action: group | ungroup | align | distribute | zorder | duplicate | copy | cut | paste | nudge; opts: ids, alignment, direction, mode, dx, dy, ... */
  arrange(action: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  connect(edges: EdgeSpec | EdgeSpec[]): Promise<{ created: Element[]; ids: string[] }>;
  connect(sourceId: string, targetId: string, opts?: Omit<EdgeSpec, "sourceId" | "targetId">): Promise<{ created: Element[]; ids: string[] }>;
  /** Auto layout of flow nodes. opts: { ids?: string[]; direction?: "TB" | "BT" | "LR" | "RL" }. */
  layout(opts?: { ids?: string[]; direction?: "TB" | "BT" | "LR" | "RL" }): Promise<Record<string, unknown>>;
  importMermaid(text: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  library(): Promise<Record<string, unknown>>;
  /** Inserts a library component by id or name. opts: { x?: number; y?: number }. */
  insertComponent(idOrName: string, opts?: { x?: number; y?: number }): Promise<Record<string, unknown>>;
  /** opts: { action: "set" | "pan" | "zoomToFit" | "zoomToSelection"; x?, y?, zoom?, dx?, dy? }. */
  viewport(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** opts: { format?, scope?, ids?, frameId?, scale?, padding?, background?, path? }; without \`path\` base64 data is returned. */
  export(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Saves to disk. Pending edits of this script are committed first (they become their own undo step). */
  save(): Promise<{ path: string; saved: boolean }>;
}

declare const ob: {
  /** Open boards and the active one: { boards: { path, dirty }[]; active?: string }. */
  boards(): Promise<{ boards: { path: string; dirty: boolean }[]; active?: string }>;
  /** Handle for a board by path; omit the path for the board given to openboard_execute, else the active board. */
  board(path?: string): BoardHandle;
  /** Escape hatch to any action (see the \`actions\` topic): ob.call("element.query", { ids: [...] }). Throws on tool errors. */
  call(action: ${actions}, input?: Record<string, unknown>): Promise<any>;
};
declare const console: { log(...a: unknown[]): void; info(...a: unknown[]): void; debug(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
`;
}
