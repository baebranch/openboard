/** Composition helper: builds the registry with all tool modules (no vscode import). */
import { registerArrangeTools } from '../../core/tools/arrange-tools';
import { registerBatchTool } from '../../core/tools/batch-tool';
import { registerConnectTools } from '../../core/tools/connect-tools';
import { registerBoardTools, type BoardLifecycleHost } from '../../core/tools/board-tools';
import { StubBoardLifecycleHost } from './lifecycle-host';
import { registerCoreExtraTools } from '../../core/tools/core-extra-tools';
import type { SelectionStore } from '../../core/tools/view-tools';
import { registerElementTools } from '../../core/tools/element-tools';
import { registerExportTools, type ExportHost } from '../../core/tools/export-tools';
import { registerImportTools } from '../../core/tools/import-tools';
import { registerLayoutTools } from '../../core/tools/layout-tools';
import { registerTokenTools } from '../../core/tools/token-tools';
import { registerComponentTools } from '../../core/tools/component-tools';
import { registerIconTools } from '../../core/tools/icon-tools';
import { DefaultToolRegistry, type ToolRegistryOptions } from '../../core/tools/registry';
import { HostBoardResolver, type BoardHost } from '../../core/tools/resolution';

export interface CreateRegistryOptions {
  boardHost: BoardHost;
  exportHost: ExportHost;
  validators?: ToolRegistryOptions['validators'];
  /** Board lifecycle host; defaults to a stub until wired in activation (16.12). */
  lifecycleHost?: BoardLifecycleHost;
  /** Per-window selection store; defaults to an in-memory store. */
  selection?: SelectionStore;
}

export function createRegistry(options: CreateRegistryOptions): DefaultToolRegistry {
  const registry = new DefaultToolRegistry({
    validators: options.validators,
    resolver: new HostBoardResolver(options.boardHost),
  });
  registerElementTools(registry);
  registerArrangeTools(registry);
  registerConnectTools(registry);
  registerLayoutTools(registry);
  registerTokenTools(registry);
  registerComponentTools(registry);
  registerIconTools(registry);
  registerImportTools(registry);
  registerExportTools(registry, options.exportHost);
  registerBoardTools(registry, options.lifecycleHost ?? new StubBoardLifecycleHost());
  registerCoreExtraTools(registry, { selection: options.selection });
  registerBatchTool(registry);
  return registry;
}
