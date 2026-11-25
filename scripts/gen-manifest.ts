/**
 * Generates `contributes.languageModelTools` in package.json (Req 14.2): exactly the five
 * polymorphic tools of the agent surface (openboard_workspaces, openboard_read_skill,
 * openboard_execute, openboard_call, openboard_save). The `openboard_call` action enum comes from
 * the tool registry, so it cannot drift.
 *
 *   npm run gen:manifest          rewrite package.json
 *   npm run gen:manifest -- --check   exit 1 when package.json is out of date
 *
 * Engine note: `engines.vscode` stays at ^1.90.0, the minimum that supports custom editors and the
 * pinned @types/vscode. The `languageModelTools` contribution point needs a newer host, but hosts
 * that do not know it simply ignore it, and the LM bridge is optional at runtime (Req 1.4).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSurface, type SurfaceTool } from '../src/codemode/surface';
import { buildFullRegistry } from '../test/helpers/registry';

export interface LanguageModelToolContribution {
  name: string;
  displayName: string;
  modelDescription: string;
  toolReferenceName: string;
  canBeReferencedInPrompt: boolean;
  tags: string[];
  inputSchema: unknown;
}

interface ListOnly {
  list(): string[];
}

const DISPLAY_NAMES: Record<string, string> = {
  openboard_workspaces: 'OpenBoard: Workspaces',
  openboard_read_skill: 'OpenBoard: Read Skill',
  openboard_execute: 'OpenBoard: Execute Script',
  openboard_call: 'OpenBoard: Call Action',
  openboard_save: 'OpenBoard: Save Board',
};

/** One contribution per exposed tool, in surface order. */
export function buildToolContributions(registry: ListOnly): LanguageModelToolContribution[] {
  return buildSurface(registry.list(), { workspace: false }).map((t: SurfaceTool) => ({
    name: t.name,
    displayName: DISPLAY_NAMES[t.name] ?? t.name,
    modelDescription: t.description,
    toolReferenceName: t.name,
    canBeReferencedInPrompt: true,
    tags: ['openboard', t.name === 'openboard_execute' ? 'code' : 'whiteboard'],
    inputSchema: t.inputSchema,
  }));
}

/** Returns a copy of `pkg` with languageModelTools regenerated. */
export function applyGenerated(pkg: Record<string, any>): Record<string, any> {
  const { registry } = buildFullRegistry({ spy: false });
  return {
    ...pkg,
    contributes: { ...(pkg.contributes ?? {}), languageModelTools: buildToolContributions(registry) },
  };
}

const serialize = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

export async function main(args: string[]): Promise<number> {
  const file = resolve(process.cwd(), 'package.json'); // npm runs scripts from the package root
  const current = readFileSync(file, 'utf8');
  const next = serialize(applyGenerated(JSON.parse(current)));
  if (args.includes('--check')) {
    if (current === next) {
      console.log('package.json is up to date');
      return 0;
    }
    console.error('package.json is out of date; run `npm run gen:manifest`');
    return 1;
  }
  if (current !== next) writeFileSync(file, next);
  console.log(current === next ? 'package.json unchanged' : 'package.json updated');
  return 0;
}
