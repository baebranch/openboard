/**
 * Entry point of dist/mcp.js: an MCP server over stdio. stdout carries MCP protocol messages only;
 * everything else goes to stderr.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { SkillFile } from '../codemode/surface';
import { openboardHome } from '../host/ipc/instances';
import type { CatalogFile } from './catalog';
import { createMcpServer } from './server';

async function main(): Promise<void> {
  // dist/mcp-tools.json and dist/mcp-skill.json sit next to this bundle; OPENBOARD_MCP_TOOLS /
  // OPENBOARD_MCP_SKILL override them (tests).
  const toolsFile = process.env.OPENBOARD_MCP_TOOLS || path.join(__dirname, 'mcp-tools.json');
  const skillFile = process.env.OPENBOARD_MCP_SKILL || path.join(__dirname, 'mcp-skill.json');
  const catalog = JSON.parse(readFileSync(toolsFile, 'utf8')) as CatalogFile;
  const skill = JSON.parse(readFileSync(skillFile, 'utf8')) as SkillFile;
  const server = createMcpServer({ catalog, skill, home: openboardHome() });
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  console.error(`[openboard-mcp] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
