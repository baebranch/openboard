/** Registers schema, summary, selection, viewport, undo/redo and library tools (task 8.2). */
import { historyTools } from './history-tools';
import { createLibraryTools } from './library-tools';
import type { DefaultToolRegistry, ToolDefinition } from './registry';
import { createSchemaTool } from './schema-tools';
import { createViewTools, MemorySelectionStore, type SelectionStore } from './view-tools';

export interface CoreExtraDeps {
  /** Per-window selection state; defaults to an in-memory store. */
  selection?: SelectionStore;
}

export function createCoreExtraTools(registry: Pick<DefaultToolRegistry, 'list' | 'describe'>, deps: CoreExtraDeps = {}): ToolDefinition[] {
  const store = deps.selection ?? new MemorySelectionStore();
  return [createSchemaTool(registry), ...createViewTools(store), ...historyTools, ...createLibraryTools(store)];
}

/** `registry` must describe every tool, so call this after the other modules are registered. */
export function registerCoreExtraTools(
  registry: Pick<DefaultToolRegistry, 'register' | 'list' | 'describe'>,
  deps: CoreExtraDeps = {},
): void {
  for (const t of createCoreExtraTools(registry, deps)) registry.register(t);
}
