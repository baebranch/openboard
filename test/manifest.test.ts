import { EXPOSED_TOOL_NAMES, buildSurface } from '../src/codemode/surface';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE_COMMAND_IDS } from '../src/host/commands';
import { SETTING_KEYS, resolveSetting, SETTING_DESCRIPTORS } from '../src/core/settings/settings';
import { applyGenerated } from '../scripts/gen-manifest';
import { buildFullRegistry } from './helpers/registry';

const raw = readFileSync(resolve(__dirname, '../package.json'), 'utf8');
const pkg = JSON.parse(raw) as Record<string, any>;
const contributes = pkg.contributes as Record<string, any>;

describe('package.json manifest', () => {
  it('languageModelTools are exactly the five exposed tools and carry required fields', () => {
    const tools = contributes.languageModelTools as Record<string, unknown>[];
    expect(tools.map((t) => t.name)).toEqual([...EXPOSED_TOOL_NAMES]);
    expect(tools.map((t) => t.toolReferenceName)).toEqual([...EXPOSED_TOOL_NAMES]);
    // The same descriptions and schemas as the generator (and as the registered LM tools).
    const registry = buildFullRegistry().registry;
    const surface = buildSurface(registry.list(), { workspace: false });
    expect(tools.map((t) => t.modelDescription)).toEqual(surface.map((t) => t.description));
    expect(tools.map((t) => t.inputSchema)).toEqual(surface.map((t) => t.inputSchema));
    for (const t of tools) {
      expect(t.displayName).toBeTruthy();
      expect(t.modelDescription).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.toolReferenceName).toMatch(/^[\w-]+$/);
      expect(t.canBeReferencedInPrompt).toBe(true);
      expect(Array.isArray(t.tags)).toBe(true);
    }
  });

  it('is up to date with the generator', () => {
    expect(JSON.stringify(applyGenerated(pkg), null, 2) + '\n').toBe(raw);
  });

  it('contributes the MCP server definition provider and the mcp.enabled setting', () => {
    expect(contributes.mcpServerDefinitionProviders).toEqual([{ id: 'openboard.mcp', label: 'OpenBoard' }]);
    expect(contributes.configuration.properties['openboard.mcp.enabled']).toMatchObject({ type: 'boolean', default: true });
    expect(pkg.engines.vscode).toBe('^1.90.0');
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toMatch(/^\d+\.\d+\.\d+$/);
    const ignore = readFileSync(resolve(__dirname, '../.vscodeignore'), 'utf8');
    expect(ignore).toContain('!dist/mcp.js');
    expect(ignore).toContain('!dist/mcp-tools.json');
    expect(ignore).toContain('!dist/mcp-skill.json');
    expect(ignore).toContain('!dist/quickjs.wasm');
    // sandbox packages are pinned to exact versions
    for (const dep of ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync']) {
      expect(pkg.dependencies[dep]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('keeps the exposed tool descriptions and input schemas under 4 KB, for MCP and LM tools', () => {
    const names = buildFullRegistry().registry.list();
    for (const workspace of [false, true]) {
      const surface = buildSurface(names, { workspace });
      expect(surface).toHaveLength(5);
      expect(JSON.stringify(surface.map((t) => [t.description, t.inputSchema])).length).toBeLessThan(4096);
    }
    const manifestTools = contributes.languageModelTools as { modelDescription: string; inputSchema: unknown }[];
    expect(JSON.stringify(manifestTools.map((t) => [t.modelDescription, t.inputSchema])).length).toBeLessThan(4096);
  });

  it('contributes exactly the seven palette commands and no invokeTool', () => {
    const ids = (contributes.commands as { command: string }[]).map((c) => c.command);
    expect([...ids].sort()).toEqual([...PALETTE_COMMAND_IDS].sort());
    expect(ids).toHaveLength(7);
    expect(ids).toContain('openboard.copyMcpConfig');
    const palette = contributes.menus.commandPalette as { command: string; when?: string }[];
    expect(palette.find((p) => p.command === 'openboard.copyMcpConfig')).toEqual({ command: 'openboard.copyMcpConfig' });
    expect(JSON.stringify(contributes)).not.toContain('openboard.invokeTool');
    for (const c of contributes.commands as { title: string }[]) expect(c.title).toMatch(/^%.+%$/);
    const nls = JSON.parse(readFileSync(resolve(__dirname, '../package.nls.json'), 'utf8')) as Record<string, string>;
    for (const c of contributes.commands as { title: string }[]) expect(nls[c.title.slice(1, -1)]).toBeTruthy();
  });

  it('configuration keys match settings and defaults', () => {
    const props = contributes.configuration.properties as Record<string, { default: unknown }>;
    // `openboard.mcp.enabled` is host-only (not a webview setting), so it is not in SETTING_KEYS.
    const webviewKeys = Object.keys(props).filter((k) => k !== 'openboard.mcp.enabled');
    expect(webviewKeys.sort()).toEqual(SETTING_KEYS.map((k) => `openboard.${k}`).sort());
    for (const k of SETTING_KEYS) {
      const ctx = { ideFontFamily: 'Fira Code' };
      const manifestDefault = props[`openboard.${k}`]!.default;
      expect(resolveSetting(k, manifestDefault, ctx)).toEqual(SETTING_DESCRIPTORS[k].getDefault(ctx));
    }
  });

  it('activates lazily and registers the custom editor, language and schema', () => {
    expect(pkg.activationEvents).not.toContain('*');
    expect(pkg.activationEvents).toContain('onCustomEditor:openboard.board');
    expect(contributes.customEditors[0]).toMatchObject({ viewType: 'openboard.board', priority: 'default' });
    expect(contributes.languages[0].extensions).toEqual(['.openboard']);
    expect(contributes.jsonValidation[0]).toMatchObject({ fileMatch: '*.openboard' });
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(pkg.main).toBe('./dist/extension.js');
  });
});
