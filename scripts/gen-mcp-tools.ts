/**
 * Generates dist/mcp-tools.json (the MCP tool catalog) and dist/mcp-skill.json (the skill topics)
 * from the tool registry and src/mcp/skill/*.md, so the stdio MCP server can answer `tools/list`
 * and serve the docs without any IDE window running, and so the docs never drift from the code.
 *
 *   npm run gen:mcp-tools
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SKILL_TOPIC_IDS } from '../src/codemode/surface';
import { buildCatalog } from '../src/mcp/catalog';
import { buildSkill } from '../src/mcp/skill/build';
import { buildFullRegistry } from '../test/helpers/registry';

export async function main(_args: string[]): Promise<number> {
  const root = process.cwd(); // npm runs scripts from the package root
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
  const { registry } = buildFullRegistry({ spy: false });
  const catalog = buildCatalog(registry, pkg.version);
  const markdown: Record<string, string> = {};
  for (const id of SKILL_TOPIC_IDS) markdown[id] = readFileSync(resolve(root, 'src/mcp/skill', `${id}.md`), 'utf8');
  const skill = buildSkill(registry, markdown, pkg.version);
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  writeFileSync(resolve(root, 'dist/mcp-tools.json'), JSON.stringify(catalog) + '\n');
  writeFileSync(resolve(root, 'dist/mcp-skill.json'), JSON.stringify(skill) + '\n');
  console.log(`dist/mcp-tools.json: ${catalog.tools.length} tools, ${catalog.actions.length} actions; dist/mcp-skill.json: ${skill.topics.length} topics`);
  return 0;
}
