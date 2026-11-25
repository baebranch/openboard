/**
 * Thin vscode glue for the LM tool bridge and `openboard.invokeTool`.
 * The installed @types/vscode predates the language-model tool API, so it is accessed structurally.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { SkillFile } from '../../codemode/surface';
import {
  createApi,
  createInvokeToolCommand,
  registerLmTools,
  type AgentRegistry,
  type LmApi,
  type OpenBoardApi,
  type ResultPart,
  type WindowInfo,
} from './bridge';

interface VsLm {
  registerTool(name: string, tool: unknown): { dispose(): void };
}
interface VsLmTypes {
  lm?: VsLm;
  LanguageModelTextPart: new (text: string) => unknown;
  LanguageModelToolResult: new (parts: unknown[]) => unknown;
  LanguageModelDataPart?: { image(data: Uint8Array, mime: string): unknown };
}

function toLmApi(vs: VsLmTypes): LmApi | undefined {
  const lm = vs.lm;
  if (!lm || typeof lm.registerTool !== 'function') return undefined;
  const dataPart = vs.LanguageModelDataPart;
  const toPart = (p: ResultPart): unknown =>
    p.kind === 'image' && dataPart ? dataPart.image(p.data, p.mimeType) : new vs.LanguageModelTextPart(p.kind === 'text' ? p.text : '');
  return {
    supportsImages: typeof dataPart?.image === 'function',
    registerTool(name, impl) {
      return lm.registerTool(name, {
        async invoke(options: { input: unknown }) {
          const parts = await impl.invoke({ input: options.input });
          return new vs.LanguageModelToolResult(parts.map(toPart));
        },
        prepareInvocation(options: { input: unknown }) {
          const p = impl.prepareInvocation({ input: options.input });
          if (!p.confirmationMessages) return {};
          return {
            confirmationMessages: {
              title: p.confirmationMessages.title,
              message: new vscode.MarkdownString(p.confirmationMessages.message),
            },
          };
        },
      });
    },
  };
}

/** Loads the bundled skill (dist/mcp-skill.json) once, on first use. */
function lazySkill(context: vscode.ExtensionContext): () => SkillFile {
  let cached: SkillFile | undefined;
  return () => {
    if (!cached) {
      const file = path.join(context.extensionUri.fsPath, 'dist', 'mcp-skill.json');
      cached = JSON.parse(readFileSync(file, 'utf8')) as SkillFile;
    }
    return cached;
  };
}

function windowInfo(): WindowInfo {
  return {
    workspaceName: vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '',
    folders: (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath),
    ide: vscode.env.appName || 'unknown',
  };
}

/** Registers LM tools and the command; returns the exported API. */
export function activateAgentSurface(context: vscode.ExtensionContext, registry: AgentRegistry, log: (m: string) => void): OpenBoardApi {
  context.subscriptions.push(
    ...registerLmTools(toLmApi(vscode as unknown as VsLmTypes), registry, { skill: lazySkill(context), windowInfo, log }),
  );
  context.subscriptions.push(vscode.commands.registerCommand('openboard.invokeTool', createInvokeToolCommand(registry)));
  return createApi(registry);
}
