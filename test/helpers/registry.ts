/**
 * Test helper: builds a DefaultToolRegistry with every tool module registered
 * (element, arrange, connect, layout, import, export) against one in-memory board.
 * Export uses stub host services. Handlers are wrapped so tests can see which ran.
 */
import type { BoardDocument } from '../../src/core/model/types';
import { BoardModel, UndoHistory } from '../../src/core/ops';
import {
  DefaultToolRegistry,
  type BoardResolver,
  type ToolDefinition,
} from '../../src/core/tools/registry';
import { registerArrangeTools } from '../../src/core/tools/arrange-tools';
import { registerBatchTool } from '../../src/core/tools/batch-tool';
import { registerBoardTools, type BoardInfo, type BoardLifecycleHost } from '../../src/core/tools/board-tools';
import { registerCoreExtraTools } from '../../src/core/tools/core-extra-tools';
import { registerConnectTools } from '../../src/core/tools/connect-tools';
import { registerElementTools } from '../../src/core/tools/element-tools';
import { registerExportTools, type ExportHost } from '../../src/core/tools/export-tools';
import { registerImportTools } from '../../src/core/tools/import-tools';
import { registerLayoutTools } from '../../src/core/tools/layout-tools';
import { registerTokenTools } from '../../src/core/tools/token-tools';
import { registerComponentTools } from '../../src/core/tools/component-tools';
import { registerIconTools } from '../../src/core/tools/icon-tools';

/** In-memory board lifecycle host. */
export class FakeLifecycleHost implements BoardLifecycleHost {
  readonly boards = new Map<string, BoardInfo>([['/b.openboard', { path: '/b.openboard', dirty: false }]]);
  /** Files that exist on disk but are not open. */
  readonly files = new Set<string>();
  activePath: string | undefined = '/b.openboard';
  calls: string[] = [];

  list(): BoardInfo[] {
    return [...this.boards.values()];
  }
  active(): string | undefined {
    return this.activePath;
  }
  async open(path: string, options?: { background?: boolean }): Promise<BoardInfo> {
    this.calls.push(`open:${path}:${options?.background === true}`);
    let b = this.boards.get(path);
    if (!b) {
      if (!this.files.has(path)) throw Object.assign(new Error(`Board not found: ${path}`), { code: 'not_found' });
      b = { path, dirty: false };
      this.boards.set(path, b);
    }
    if (!options?.background) this.activePath = path;
    return b;
  }
  async create(path: string): Promise<BoardInfo> {
    this.calls.push(`create:${path}`);
    if (this.files.has(path) || this.boards.has(path)) {
      throw Object.assign(new Error(`Already exists: ${path}`), { code: 'already_exists' });
    }
    this.files.add(path);
    const b = { path, dirty: false };
    this.boards.set(path, b);
    this.activePath = path;
    return b;
  }
  async save(path: string): Promise<void> {
    this.calls.push(`save:${path}`);
    const b = this.boards.get(path);
    if (b) b.dirty = false;
  }
  async close(path: string, options: { discard: boolean }): Promise<void> {
    this.calls.push(`close:${path}:${options.discard}`);
    this.boards.delete(path);
    if (this.activePath === path) this.activePath = undefined;
  }
}

export const emptyBoardDoc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

export interface FullRegistryOptions {
  doc?: BoardDocument;
  host?: Partial<ExportHost>;
  lifecycleHost?: BoardLifecycleHost;
  /** Wrap handlers with call counters (default true). */
  spy?: boolean;
}

export interface FullRegistry {
  registry: DefaultToolRegistry;
  model: BoardModel;
  history: UndoHistory;
  host: ExportHost;
  /** Number of times each tool's handler started (by tool name). */
  handlerCalls: Map<string, number>;
  /** Total handler invocations across all tools. */
  totalHandlerCalls(): number;
  /** Number of times the board resolver was consulted. */
  resolverCalls(): number;
  /** Resolved tool definitions by name. */
  defs: Map<string, ToolDefinition>;
}

export function buildFullRegistry(options: FullRegistryOptions = {}): FullRegistry {
  const history = new UndoHistory();
  let tick = 0;
  const model = new BoardModel('/b.openboard', options.doc ?? emptyBoardDoc(), { history, now: () => `T${++tick}` });
  const host: ExportHost = {
    rasterize: async () => new Uint8Array(),
    writeFile: async () => undefined,
    ...options.host,
  };
  let resolved = 0;
  const resolver: BoardResolver = {
    resolve: () => {
      resolved += 1;
      return { ok: true, model };
    },
  };
  const registry = new DefaultToolRegistry({ resolver });
  const handlerCalls = new Map<string, number>();
  const defs = new Map<string, ToolDefinition>();
  const spy = options.spy !== false;
  const collector = {
    register(def: ToolDefinition): void {
      const wrapped: ToolDefinition = spy
        ? {
            ...def,
            handler: (ctx, input) => {
              handlerCalls.set(def.name, (handlerCalls.get(def.name) ?? 0) + 1);
              return def.handler(ctx, input);
            },
          }
        : def;
      defs.set(def.name, wrapped);
      registry.register(wrapped);
    },
  };
  registerElementTools(collector);
  registerArrangeTools(collector);
  registerConnectTools(collector);
  registerLayoutTools(collector);
  registerTokenTools(collector);
  registerComponentTools(collector);
  registerIconTools(collector);
  registerImportTools(collector);
  registerExportTools(collector, host);
  registerBoardTools(collector, options.lifecycleHost ?? new FakeLifecycleHost());
  registerCoreExtraTools({
    register: collector.register,
    list: () => registry.list(),
    describe: (n) => registry.describe(n),
  });
  registerBatchTool(registry);
  return {
    registry,
    model,
    history,
    host,
    handlerCalls,
    totalHandlerCalls: () => [...handlerCalls.values()].reduce((a, b) => a + b, 0),
    resolverCalls: () => resolved,
    defs,
  };
}
