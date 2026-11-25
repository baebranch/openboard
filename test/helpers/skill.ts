/** Test helper: builds the skill exactly like scripts/gen-mcp-tools.ts, from the live registry. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SKILL_TOPIC_IDS, type SkillFile } from '../../src/codemode/surface';
import { buildSkill } from '../../src/mcp/skill/build';

interface BuildRegistry {
  list(): string[];
  describe(name: string): { description: string; inputSchema: unknown };
}

export function loadSkill(registry: BuildRegistry, version = '0.0.0'): SkillFile {
  const markdown: Record<string, string> = {};
  for (const id of SKILL_TOPIC_IDS) {
    markdown[id] = readFileSync(path.resolve(__dirname, '../../src/mcp/skill', `${id}.md`), 'utf8');
  }
  return buildSkill(registry, markdown, version);
}
