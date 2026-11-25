/**
 * MCP tool catalog: built at build time from the tool registry (scripts/gen-mcp-tools.ts) so that
 * `tools/list` works without any IDE window running. Pure: no node or vscode imports.
 */
import { buildSurface, type SurfaceTool } from '../codemode/surface';

export interface CatalogFile {
  version: string;
  /** Registry tool names reachable through `openboard_call` (the dotted `openboard.*` names). */
  actions: string[];
  /** The exposed MCP tools (every tool except `openboard_workspaces` takes `workspace`). */
  tools: SurfaceTool[];
}

interface RegistryView {
  list(): string[];
}

export function buildCatalog(registry: RegistryView, version: string): CatalogFile {
  const actions = registry.list();
  return { version, actions, tools: buildSurface(actions, { workspace: true }) };
}
