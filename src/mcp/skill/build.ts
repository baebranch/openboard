/**
 * Builds the bundled skill (dist/mcp-skill.json) from hand-written markdown (src/mcp/skill/*.md)
 * plus parts generated from the registry and the element schemas, so the docs cannot drift.
 * Pure: the caller supplies the markdown text.
 */
import { elementDocs, propLines } from '../../codemode/element-docs';
import { buildObDeclarations } from '../../codemode/ob-api';
import { schemaToTs } from '../../codemode/schema-ts';
import { SKILL_TOPIC_IDS, shortAction, type SkillFile, type SkillTopic } from '../../codemode/surface';

const GENERATED_MARKER = '<!-- generated -->';

const SUMMARIES: Record<(typeof SKILL_TOPIC_IDS)[number], string> = {
  overview: 'concepts: boards, elements, ids, z-order, frames, edges, undo, workspace param; tool overview',
  elements: 'every element type and its properties, style, text',
  editing: 'create / update / delete / arrange / connect elements; selection rules',
  flowcharts: 'flow nodes, edges, Mermaid import, auto layout',
  export: 'formats, scopes, options, preview',
  library: 'built-in and saved components',
  'code-mode': 'how to use openboard_execute: the `ob` API (TypeScript declarations), examples, limits',
  actions: 'every action of openboard_call with its input schema',
};

interface BuildRegistry {
  list(): string[];
  describe(name: string): { description: string; inputSchema: unknown };
}

type Schema = { [key: string]: unknown };
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

function fill(markdown: string, generated: string): string {
  return markdown.includes(GENERATED_MARKER)
    ? markdown.replace(GENERATED_MARKER, generated.trimEnd())
    : `${markdown.trimEnd()}\n\n${generated.trimEnd()}`;
}

function elementsReference(registry: BuildRegistry): string {
  const docs = elementDocs(registry);
  const lines = [
    '## Reference (generated from the element schemas)',
    '',
    'Properties of every element:',
    '',
    '```ts',
    `type: ${docs.types.map((t) => JSON.stringify(t)).join(' | ')};`,
    propLines(docs.common, [], ''),
    '```',
    '',
    'Extra properties per type (`type` is always required; `?` marks optional):',
    '',
  ];
  for (const type of docs.types) {
    const extra = docs.extras[type];
    if (!extra) continue;
    const body = propLines(extra.props, extra.required, '');
    lines.push(`- **${type}**${body ? '' : ': no extra properties'}`);
    if (body) lines.push('  ```ts', ...body.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return lines.join('\n');
}

/** An action's input type; `elements` items are shown once in the `elements` topic. */
function actionInputType(name: string, schema: unknown): string {
  let s = schema;
  if (name === 'openboard.element.create' && isObj(schema) && isObj(schema.properties)) {
    s = { ...schema, properties: { ...schema.properties, elements: { type: 'array', items: { $ref: 'ElementInput' }, minItems: 1, maxItems: 1000 } } };
  }
  return schemaToTs(s, { named: { ElementInput: 'ElementInput /* see topic elements */' }, width: 100 });
}

function actionsReference(registry: BuildRegistry): string {
  const out: string[] = ['## Action list', ''];
  for (const name of registry.list()) {
    const d = registry.describe(name);
    out.push(`### ${shortAction(name)}`, '', d.description, '', '```ts', `input: ${actionInputType(name, d.inputSchema)}`, '```', '');
  }
  return out.join('\n');
}

export function buildSkill(registry: BuildRegistry, markdown: Record<string, string>, version: string): SkillFile {
  const names = registry.list();
  const generated: Record<string, string> = {
    elements: elementsReference(registry),
    'code-mode': `\`\`\`ts\n${buildObDeclarations(registry, names.map(shortAction)).trimEnd()}\n\`\`\``,
    actions: actionsReference(registry),
  };
  const topics: SkillTopic[] = SKILL_TOPIC_IDS.map((id) => {
    const md = markdown[id];
    if (md === undefined) throw new Error(`Missing skill markdown: src/mcp/skill/${id}.md`);
    const extra = generated[id];
    return { id, summary: SUMMARIES[id], content: (extra === undefined ? md : fill(md, extra)).trim() + '\n' };
  });
  return { version, topics };
}
