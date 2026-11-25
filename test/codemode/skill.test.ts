import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { elementDocs } from '../../src/codemode/element-docs';
import { buildObDeclarations } from '../../src/codemode/ob-api';
import {
  SKILL_TOPIC_IDS,
  buildSurface,
  readSkill,
  resolveAction,
  shortAction,
  skillIndex,
  surfaceSize,
  withSkillHint,
} from '../../src/codemode/surface';
import { buildFullRegistry } from '../helpers/registry';
import { loadSkill } from '../helpers/skill';

const { registry } = buildFullRegistry({ spy: false });
const skill = loadSkill(registry, '1.2.3');
const topic = (id: string): string => skill.topics.find((t) => t.id === id)!.content;

describe('skill', () => {
  it('has every required topic, in order, each with a one-line summary', () => {
    expect(skill.topics.map((t) => t.id)).toEqual([...SKILL_TOPIC_IDS]);
    expect(skill.version).toBe('1.2.3');
    for (const t of skill.topics) {
      expect(t.summary).not.toContain('\n');
      expect(t.content.length).toBeGreaterThan(200);
      expect(t.content).not.toContain('<!-- generated -->');
    }
  });

  it('index lists every topic with its summary; unknown topics list the valid ones', () => {
    const index = readSkill(skill, undefined);
    expect(index.ok).toBe(true);
    const text = index.ok ? index.text : '';
    expect(text).toBe(skillIndex(skill));
    for (const t of skill.topics) expect(text).toContain(`- ${t.id}: ${t.summary}`);
    expect(readSkill(skill, '')).toEqual(index);
    expect(readSkill(skill, 'Code-Mode')).toEqual({ ok: true, text: topic('code-mode') });
    const unknown = readSkill(skill, 'nope');
    expect(unknown).toMatchObject({ ok: false, code: 'unknown_topic' });
    if (!unknown.ok) for (const id of SKILL_TOPIC_IDS) expect(unknown.message).toContain(id);
    expect(readSkill(skill, 5)).toMatchObject({ ok: false });
  });

  it('elements topic is generated from the element schemas (every type and property)', () => {
    const docs = elementDocs(registry);
    expect(docs.types).toHaveLength(12);
    const text = topic('elements');
    for (const t of docs.types) expect(text, t).toContain(`**${t}**`);
    for (const p of [...Object.keys(docs.common), ...Object.values(docs.extras).flatMap((e) => Object.keys(e.props))]) {
      expect(text, p).toContain(p);
    }
    expect(text).toContain('preset?: "startEnd" | "process" | "decision"');
  });

  it('actions topic lists every registry action, derived from the schemas', () => {
    const text = topic('actions');
    for (const name of registry.list()) {
      expect(text).toContain(`### ${shortAction(name)}\n`);
      expect(text).toContain(registry.describe(name).description);
    }
    expect(text).toContain('elements: Array<ElementInput /* see topic elements */>');
    expect(text).toContain('action: "group" | "ungroup" | "align"');
  });

  it('code-mode topic carries the declarations of the whole ob API', () => {
    const text = topic('code-mode');
    for (const m of ['summary', 'query', 'get', 'create', 'update', 'remove', 'arrange', 'connect', 'layout', 'importMermaid', 'library', 'insertComponent', 'viewport', 'export', 'save']) {
      expect(text, m).toContain(`${m}(`);
    }
    expect(text).toContain('boards()');
    expect(text).toContain('call(action:');
    expect(text).toContain('"element.create"');
    for (const limit of ['timeoutMs', '64 MB', 'one undo']) expect(text.toLowerCase()).toContain(limit.toLowerCase());
  });
});

describe('ob declarations', () => {
  const dts = buildObDeclarations(registry, registry.list().map(shortAction));

  it('are valid TypeScript, and the documented examples type-check against them', () => {
    const blocks: string[] = [];
    for (const id of ['code-mode', 'editing', 'flowcharts']) {
      for (const m of topic(id).matchAll(/```js\n([\s\S]*?)```/g)) blocks.push(m[1] as string);
    }
    expect(blocks.length).toBeGreaterThanOrEqual(8);

    const files = new Map<string, string>([['/ob.d.ts', dts]]);
    blocks.forEach((b, i) => files.set(`/example${i}.ts`, `export {};\nasync function main() {\n${b}\n}\nvoid main;\n`));
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts'],
      noEmit: true,
      strict: false,
      noImplicitAny: false,
      skipLibCheck: true,
      types: [],
      allowUnreachableCode: true,
    };
    const host = ts.createCompilerHost(options);
    const realRead = host.readFile.bind(host);
    const realExists = host.fileExists.bind(host);
    const realSource = host.getSourceFile.bind(host);
    host.fileExists = (f) => files.has(f) || realExists(f);
    host.readFile = (f) => files.get(f) ?? realRead(f);
    host.getSourceFile = (f, lang, ...rest) => {
      const text = files.get(f);
      return text !== undefined ? ts.createSourceFile(f, text, lang) : realSource(f, lang, ...rest);
    };
    const program = ts.createProgram([...files.keys()], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
      const where = d.file ? `${d.file.fileName}:${d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0}` : '';
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
    expect(diagnostics).toEqual([]);
  }, 60_000);

  it('mention every action in the ob.call union and the shared element properties', () => {
    for (const n of registry.list()) expect(dts).toContain(JSON.stringify(shortAction(n)));
    expect(dts).toContain('type ElementType = "rectangle"');
    expect(dts).toContain('interface ElementInput');
  });
});

describe('exposed surface', () => {
  const names = registry.list();

  it('is five tools whose descriptions and schemas total under 4 KB (MCP and LM variants)', () => {
    for (const workspace of [true, false]) {
      const surface = buildSurface(names, { workspace });
      expect(surface.map((t) => t.name)).toEqual(['openboard_workspaces', 'openboard_read_skill', 'openboard_execute', 'openboard_call', 'openboard_save']);
      expect(JSON.stringify(surface.map((t) => [t.name, t.description, t.inputSchema])).length).toBeLessThan(4096);
      expect(surfaceSize(surface)).toBeLessThan(4096);
      for (const t of surface) expect(t.name).toMatch(/^[\w-]+$/);
    }
    // `workspace` only exists on the MCP variant
    expect(JSON.stringify(buildSurface(names, { workspace: false }))).not.toContain('workspace"');
  });

  it('openboard_call description lists the action names and points to the skill', () => {
    const call = buildSurface(names, { workspace: true }).find((t) => t.name === 'openboard_call')!;
    for (const n of names) expect(call.description).toContain(shortAction(n));
    expect(call.description).toContain('actions');
    expect(call.description.length).toBeLessThan(600);
  });

  it('resolves actions in short or full form and validates input', () => {
    expect(resolveAction(names, { action: 'element.create', input: { a: 1 } })).toEqual({ ok: true, registryName: 'openboard.element.create', input: { a: 1 } });
    expect(resolveAction(names, { action: 'openboard.batch', input: '{"operations":[]}' })).toMatchObject({ ok: true, registryName: 'openboard.batch' });
    expect(resolveAction(names, { action: 'connect' })).toMatchObject({ ok: true, input: {} });
    expect(resolveAction(names, { action: 'zzz' })).toMatchObject({ ok: false, error: { code: 'unknown_action' } });
    expect(resolveAction(names, {})).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(resolveAction(names, { action: 'connect', input: [1] })).toMatchObject({ ok: false });
    expect(resolveAction(names, { action: 'connect', input: '{bad' })).toMatchObject({ ok: false });
  });

  it('adds a skill hint to validation errors only', () => {
    const validation = withSkillHint({ error: { code: 'invalid_input', message: 'Invalid input for x', issues: [{ path: '/a', message: 'bad' }] } }, 'openboard.connect') as any;
    expect(validation.error.issues).toHaveLength(1);
    expect(validation.error.hint).toContain('connect');
    const other = { error: { code: 'not_found', message: 'gone' } };
    expect(withSkillHint(other, 'openboard.connect')).toBe(other);
    const fine = { ids: [] };
    expect(withSkillHint(fine, 'openboard.connect')).toBe(fine);
  });
});

describe('docs and README', () => {
  it('README documents the five tools and code mode', () => {
    const readme = readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
    for (const n of ['openboard_workspaces', 'openboard_read_skill', 'openboard_execute', 'openboard_call', 'openboard_save']) {
      expect(readme, n).toContain(n);
    }
    expect(readme).toContain('QuickJS');
  });
});
