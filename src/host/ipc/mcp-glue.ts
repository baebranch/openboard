/**
 * vscode glue for the MCP channel: starts/stops the per-window local channel (setting
 * `openboard.mcp.enabled`), keeps its record in sync with the workspace folders, registers the
 * MCP server definition provider when the host supports it, and implements "Copy MCP Server Config".
 * `vscode.lm.registerMcpServerDefinitionProvider` is newer than the pinned typings, so it is
 * accessed structurally and feature-detected.
 */
import path from 'node:path';
import * as vscode from 'vscode';
import { openboardHome } from './instances';
import { buildMcpConfig, ensureLauncher, nodeOnPath } from './launcher';
import { IpcChannel, type ChannelRegistry } from './server';

export const MCP_PROVIDER_ID = 'openboard.mcp';
export const MCP_SETTING = 'mcp.enabled';
export const COPIED_MESSAGE = 'OpenBoard MCP server config copied to the clipboard.';

interface VsMcpTypes {
  lm?: { registerMcpServerDefinitionProvider?(id: string, provider: unknown): { dispose(): void } };
  McpStdioServerDefinition?: new (
    label: string,
    command: string,
    args?: string[],
    env?: Record<string, string | number | null>,
    version?: string,
  ) => unknown;
}

export interface McpController {
  readonly channel: IpcChannel;
  copyConfig(): Promise<void>;
  dispose(): void;
}

export function activateMcp(context: vscode.ExtensionContext, registry: ChannelRegistry, log: (m: string) => void): McpController {
  const home = openboardHome();
  const extensionPath = context.extensionUri.fsPath;
  const mcpEntry = path.join(extensionPath, 'dist', 'mcp.js');
  const version = (context as { extension?: { packageJSON?: { version?: string } } }).extension?.packageJSON?.version ?? '0.0.0';
  const vs = vscode as unknown as VsMcpTypes;

  const folders = (): string[] =>
    (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  const workspaceName = (): string => vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '';

  const channel = new IpcChannel({
    registry,
    home,
    ide: vscode.env.appName || 'unknown',
    version,
    folders,
    workspaceName,
    log,
  });

  const isEnabled = (): boolean => vscode.workspace.getConfiguration('openboard').get<boolean>(MCP_SETTING) ?? true;
  const definitionsChanged = new vscode.EventEmitter<void>();
  const disposables: { dispose(): unknown }[] = [definitionsChanged];

  let starting: Promise<void> = Promise.resolve();
  let disposed = false;
  const apply = (): void => {
    starting = starting
      .then(async () => {
        if (disposed) return;
        if (isEnabled()) {
          if (!channel.running) await channel.start();
        } else if (channel.running) {
          channel.stop();
        }
        definitionsChanged.fire();
      })
      .catch((e: unknown) => log(`warn: MCP channel could not start: ${String(e)}`));
  };

  try {
    ensureLauncher(home, mcpEntry);
  } catch (e) {
    log(`warn: could not write the MCP launcher: ${String(e)}`);
  }

  // --- auto registration (VS Code 1.101+); absent on older hosts and forks such as Kiro.
  const register = vs.lm?.registerMcpServerDefinitionProvider;
  if (typeof register === 'function' && typeof vs.McpStdioServerDefinition === 'function') {
    const Definition = vs.McpStdioServerDefinition;
    const provider = {
      onDidChangeMcpServerDefinitions: definitionsChanged.event,
      provideMcpServerDefinitions: async (): Promise<unknown[]> =>
        channel.running
          ? [
              new Definition(
                'OpenBoard',
                process.execPath,
                [mcpEntry],
                { ELECTRON_RUN_AS_NODE: '1', OPENBOARD_WORKSPACE_ID: channel.workspaceId },
                version,
              ),
            ]
          : [],
    };
    disposables.push(register.call(vs.lm, MCP_PROVIDER_ID, provider));
  } else {
    log('MCP server definition provider API is unavailable in this host; use "OpenBoard: Copy MCP Server Config" to configure your agent.');
  }

  disposables.push(
    channel.onDidChangeWorkspaceId(() => definitionsChanged.fire()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => channel.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`openboard.${MCP_SETTING}`)) apply();
    }),
  );
  apply();

  return {
    channel,
    async copyConfig() {
      let launcher: string;
      try {
        launcher = ensureLauncher(home, mcpEntry);
      } catch (e) {
        void vscode.window.showErrorMessage(String(e));
        return;
      }
      const config = buildMcpConfig({ launcher, execPath: process.execPath, hasNode: nodeOnPath(process.env.PATH ?? process.env.Path) });
      await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
      void vscode.window.showInformationMessage(vscode.l10n.t('OpenBoard MCP server config copied to the clipboard.'));
    },
    dispose() {
      disposed = true;
      channel.stop();
      for (const d of disposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* best effort */
        }
      }
    },
  };
}
