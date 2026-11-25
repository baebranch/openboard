/**
 * Action coverage (Req 13.2, 13.3, 14.2, 13.13): every UI action maps to an existing registry tool
 * with schema-valid input, docs list every action, the manifest mirrors the registry, and the
 * agent bridge has no per-tool code.
 */
import { EXPOSED_TOOL_NAMES, shortAction } from '../src/codemode/surface';
import { buildCatalog } from '../src/mcp/catalog';
import { loadSkill } from './helpers/skill';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { ACTIONS, ActionId, buildAction } from '../src/webview/actions';
import {
  connectOp,
  createOp,
  deleteOp,
  freehandOp,
  moveOp,
  resizeOp,
  rotateOp,
} from '../src/webview/canvas/gestures';
import { toToolInput, initialDialogState, buildOptions } from '../src/webview/export/model';
import { altTextOp, classifyPasteText, cropOp } from '../src/webview/editing/media';
import { buildUpdateOp } from '../src/webview/properties/model';
import { buildFullRegistry } from './helpers/registry';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');
const { registry } = buildFullRegistry();
const names = new Set(registry.list());
const ajv = new Ajv({ strict: false, allErrors: true });

interface AnyOp {
  tool: string;
  input: unknown;
}

function checkOp(op: AnyOp): void {
  expect(names.has(op.tool), `tool ${op.tool} exists`).toBe(true);
  const validate = ajv.compile(registry.describe(op.tool).inputSchema as object);
  const ok = validate(op.input);
  expect(ok, `${op.tool}: ${JSON.stringify(validate.errors)}`).toBe(true);
  if (op.tool === 'openboard.batch') {
    for (const sub of (op.input as { operations: AnyOp[] }).operations) checkOp(sub);
  }
}

describe('UI actions map to registry tools', () => {
  for (const id of Object.values(ActionId)) {
    it(`action ${id}`, () => {
      const built = buildAction(id, {
        ids: ['a', 'b', 'c'],
        clipboard: { elements: [] },
        offset: { x: 10, y: 10 },
        dx: 1,
        dy: 0,
        amount: 10,
      });
      expect(built.tool).toBe(ACTIONS[id].tool);
      checkOp(built);
    });
  }

  it('gesture, property, media and export ops reference existing tools with valid input', () => {
    const els = [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      { id: 'b', type: 'rectangle', x: 20, y: 0, width: 10, height: 10, rotation: 0 },
    ] as never[];
    const bounds = { x: 0, y: 0, width: 30, height: 10 };
    const ops: Array<AnyOp | undefined> = [
      moveOp(els, ['a'], 5, 5),
      moveOp(els, ['a', 'b'], 5, 5),
      resizeOp(els, ['a', 'b'], bounds, { ...bounds, width: 60 }),
      rotateOp(els, ['a', 'b'], 15),
      createOp('rectangle', { x: 0, y: 0, width: 10, height: 10, rotation: 0 }),
      freehandOp([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] as never, false),
      deleteOp(['a']),
      connectOp('a', 'b', { x: 0, y: 0 }),
      connectOp('a', undefined, { x: 10, y: 10 }),
      buildUpdateOp(['a'], { x: 3 }),
      cropOp('a', { x: 0, y: 0, width: 1, height: 1 } as never),
      altTextOp('a', 'alt'),
      { tool: 'openboard.export', input: toToolInput(buildOptions(initialDialogState(), [])) },
    ];
    const mermaid = classifyPasteText('flowchart TD\n  A --> B');
    if (mermaid.kind === 'mermaid') ops.push(mermaid.op);
    else throw new Error('mermaid paste not classified');
    for (const op of ops) {
      expect(op).toBeDefined();
      checkOp(op as AnyOp);
    }
  });
});

describe('docs/action-coverage.md', () => {
  const doc = read('docs/action-coverage.md');
  it('lists every ActionId and its tool', () => {
    for (const id of Object.values(ActionId)) {
      expect(doc, `ActionId ${id}`).toContain(`\`${id}\``);
      expect(doc).toContain(`\`${ACTIONS[id].tool}\``);
    }
  });
});

describe('the five exposed tools cover every registry action', () => {
  const pkg = JSON.parse(read('package.json')) as {
    contributes: { languageModelTools: Array<{ name: string; inputSchema: any }> };
  };
  const tools = pkg.contributes.languageModelTools;
  const shortNames = registry.list().map(shortAction);

  it('manifest languageModelTools are exactly the exposed tools', () => {
    expect(tools.map((t) => t.name)).toEqual([...EXPOSED_TOOL_NAMES]);
  });

  it('the openboard_call enum (manifest and MCP catalog) equals the registry action list', () => {
    const call = tools.find((t) => t.name === 'openboard_call')!;
    expect(call.inputSchema.properties.action.enum).toEqual(shortNames);
    const catalog = buildCatalog(registry, '0');
    const mcpCall = catalog.tools.find((t) => t.name === 'openboard_call')!;
    expect((mcpCall.inputSchema.properties as any).action.enum).toEqual(shortNames);
    expect(catalog.actions).toEqual(registry.list());
  });

  it('the `actions` skill topic documents every registry action with its description', () => {
    const topic = loadSkill(registry).topics.find((t) => t.id === 'actions')!;
    for (const name of registry.list()) {
      expect(topic.content, name).toContain(`### ${shortAction(name)}\n`);
      expect(topic.content, name).toContain(registry.describe(name).description);
    }
    // schema-derived: the batch tool's `operations` and a required field are rendered
    expect(topic.content).toContain('operations: Array<');
    expect(topic.content).toMatch(/### element\.update[\s\S]*set: Record<string, unknown>/);
  });

  it('every UI action tool is reachable as an openboard_call action', () => {
    for (const id of Object.values(ActionId)) expect(shortNames).toContain(shortAction(ACTIONS[id].tool));
  });
});

describe('exposure paths are registry-derived (Req 13.13)', () => {
  for (const f of ['src/host/agent/bridge.ts', 'src/host/agent/lm-glue.ts', 'src/mcp/server.ts', 'src/mcp/catalog.ts']) {
    it(`${f} has no openboard.* tool name literals`, () => {
      const src = read(f);
      const literals = src.match(/['"`]openboard\.[a-z]+(\.[a-z]+)*['"`]/g) ?? [];
      expect(literals).toEqual([]);
      for (const n of names) expect(src.includes(n)).toBe(false);
    });
  }
});
