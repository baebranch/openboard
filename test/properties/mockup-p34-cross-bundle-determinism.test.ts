import path from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { build } from 'esbuild';
import { measure } from '../../src/core/text/measure';
import { runLayoutPass } from '../../src/core/layout/run-layout-pass';
import { runSandbox } from '../../src/codemode/sandbox';
import type { BoardDocument, Element } from '../../src/core/model/types';
import type { LayoutConfig } from '../../src/core/layout/types';

/**
 * Feature: mockup-design-features, Property 34: Cross-bundle determinism
 * (also completes the determinism clause of Property 28)
 *
 * The same pure Text_Measurer / Layout_Pass code is bundled the way the webview (browser IIFE) and the
 * Extension Host (node CJS) are bundled, and is also run inside the real QuickJS code-mode sandbox.
 * All four evaluations (plain import, webview-style bundle, host-style bundle, QuickJS) must produce
 * identical numeric output on the same generated inputs.
 */

const root = path.resolve(__dirname, '..', '..');
const posix = (p: string): string => p.split(path.sep).join('/');

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const spacing = fc.integer({ min: 0, max: 30 });
const mode = fc.constantFrom('fixed', 'hug', 'fill');
const sizingArb = fc.option(fc.record({ width: mode, height: mode }), { nil: undefined });
const layoutArb: fc.Arbitrary<LayoutConfig> = fc.record({
  direction: fc.constantFrom('horizontal', 'vertical'),
  gap: spacing,
  padding: fc.record({ top: spacing, right: spacing, bottom: spacing, left: spacing }),
  mainAlign: fc.constantFrom('start', 'center', 'end', 'spaceBetween'),
  crossAlign: fc.constantFrom('start', 'center', 'end'),
});
const geom = fc.record({
  x: fc.integer({ min: -100, max: 300 }),
  y: fc.integer({ min: -100, max: 300 }),
  width: fc.integer({ min: 1, max: 150 }),
  height: fc.integer({ min: 1, max: 150 }),
});
const childSpec = fc.record({
  kind: fc.constantFrom('rect', 'text', 'wrapText', 'frame'),
  g: geom,
  sizing: sizingArb,
  ignore: fc.boolean(),
  content: fc.constantFrom('Hi', 'Hello world', 'A much longer line of text to wrap around', 'ünïcode ✓ 日本語 text', ''),
  layout: layoutArb,
  grandkids: fc.array(fc.record({ g: geom, sizing: sizingArb, text: fc.boolean() }), { maxLength: 3 }),
});

const docArb: fc.Arbitrary<BoardDocument> = fc
  .record({ rootLayout: layoutArb, rootGeom: geom, rootSizing: sizingArb, kids: fc.array(childSpec, { maxLength: 5 }) })
  .map(({ rootLayout, rootGeom, rootSizing, kids }) => {
    const els: Element[] = [
      { id: 'root', type: 'frame', name: 'root', ...rootGeom, rotation: 0, style, layout: rootLayout, ...(rootSizing ? { sizing: rootSizing } : {}) } as Element,
    ];
    kids.forEach((k, i) => {
      const id = `k${i}`;
      const common = { id, parentId: 'root', ...k.g, rotation: 0, style, ...(k.sizing ? { sizing: k.sizing } : {}), ...(k.ignore ? { ignoreLayout: true } : {}) };
      if (k.kind === 'rect') els.push({ type: 'rectangle', ...common } as Element);
      else if (k.kind === 'text' || k.kind === 'wrapText') {
        els.push({
          type: 'text', ...common, runs: [{ text: k.content }], fontFamily: 'sans', fontSize: 12, align: 'left',
          ...(k.kind === 'wrapText' ? { textWrap: 'wrap' } : {}),
        } as Element);
      } else {
        els.push({ type: 'frame', name: id, ...common, layout: k.layout } as Element);
        k.grandkids.forEach((gk, j) => {
          const gc = { id: `${id}g${j}`, parentId: id, ...gk.g, rotation: 0, style, ...(gk.sizing ? { sizing: gk.sizing } : {}) };
          els.push(
            gk.text
              ? ({ type: 'text', ...gc, runs: [{ text: 'Nested text' }], fontFamily: 'sans', fontSize: 12, align: 'left' } as Element)
              : ({ type: 'rectangle', ...gc } as Element),
          );
        });
      }
    });
    return { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: els, assets: [], library: [] } as BoardDocument;
  });

/** `availableWidth: null` stands for Infinity (JSON cannot carry it). */
const measureArb = fc.record({
  text: fc.oneof(
    fc.string({ maxLength: 60 }),
    fc.string({ unit: 'grapheme', maxLength: 30 }),
    fc.constantFrom('', ' ', 'Hello world', 'a very long line of text that has to wrap at several places\nsecond line'),
  ),
  fontFamily: fc.constantFrom('sans', 'serif', 'mono'),
  fontSize: fc.oneof(fc.integer({ min: 1, max: 96 }), fc.double({ min: 0.5, max: 96, noNaN: true, noDefaultInfinity: true })),
  fontWeight: fc.option(fc.constantFrom(300, 400, 700), { nil: undefined }),
  availableWidth: fc.oneof(fc.integer({ min: 0, max: 400 }), fc.double({ min: 0, max: 400, noNaN: true, noDefaultInfinity: true }), fc.constant(null)),
});

interface Inputs {
  m: Array<{ text: string; fontFamily: string; fontSize: number; fontWeight?: number; availableWidth: number | null }>;
  l: BoardDocument[];
}

const RUNS = 120;
let inputs: Inputs;
let inputJson: string;
let reference: string;

/** Entry bundled for every target: runs both pure functions and returns the numeric output as JSON text. */
const entry = `
import { measure } from '${posix(path.join(root, 'src/core/text/measure'))}';
import { runLayoutPass } from '${posix(path.join(root, 'src/core/layout/run-layout-pass'))}';
export function run(json) {
  const inp = JSON.parse(json);
  const m = inp.m.map((i) => measure({ ...i, availableWidth: i.availableWidth === null ? Infinity : i.availableWidth }));
  const l = inp.l.map((d) => {
    const r = runLayoutPass(d);
    return { ids: r.changedIds, g: r.doc.elements.map((e) => [e.id, e.x, e.y, e.width, e.height]) };
  });
  return JSON.stringify({ m, l });
}
`;

async function bundle(kind: 'webview' | 'host'): Promise<string> {
  const r = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: `entry-${kind}.ts`, loader: 'ts' },
    bundle: true,
    write: false,
    sourcemap: false,
    ...(kind === 'webview'
      ? { platform: 'browser' as const, format: 'iife' as const, globalName: '__ob', target: 'es2022' }
      : { platform: 'node' as const, format: 'cjs' as const, target: 'node18' }),
  });
  return r.outputFiles[0]!.text;
}

beforeAll(() => {
  inputs = {
    m: fc.sample(measureArb, { numRuns: RUNS, seed: 34 }) as Inputs['m'],
    l: fc.sample(docArb, { numRuns: RUNS, seed: 28 }),
  };
  inputJson = JSON.stringify(inputs);
  // Reference: the modules imported directly under Vitest/Node.
  const m = inputs.m.map((i) => measure({ ...i, availableWidth: i.availableWidth === null ? Infinity : i.availableWidth }));
  const l = inputs.l.map((d) => {
    const r = runLayoutPass(d);
    return { ids: r.changedIds, g: r.doc.elements.map((e) => [e.id, e.x, e.y, e.width, e.height]) };
  });
  reference = JSON.stringify({ m, l });
});

describe('Property 34: Cross-bundle determinism', () => {
  it('uses at least 100 generated inputs per function', () => {
    // **Validates: Requirements 28.8, 22.6**
    expect(inputs.m.length).toBeGreaterThanOrEqual(100);
    expect(inputs.l.length).toBeGreaterThanOrEqual(100);
    expect(inputs.l.some((d) => d.elements.length > 3)).toBe(true);
  });

  it('webview-style bundle (browser IIFE) matches the direct import', async () => {
    // **Validates: Requirements 28.8, 22.6**
    const code = await bundle('webview');
    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(`${code}\nglobalThis.__out = __ob.run(${JSON.stringify(inputJson)});`, sandbox);
    expect(sandbox.__out).toBe(reference);
  });

  it('Extension Host-style bundle (node CJS) matches the direct import', async () => {
    // **Validates: Requirements 28.8, 22.6**
    const code = await bundle('host');
    const mod: { exports: { run?: (j: string) => string } } = { exports: {} };
    vm.runInNewContext(code, { module: mod, exports: mod.exports });
    expect(mod.exports.run!(inputJson)).toBe(reference);
  });

  it('code-mode QuickJS sandbox matches the direct import', async () => {
    // **Validates: Requirements 28.8, 22.6**
    const code = await bundle('webview');
    const r = await runSandbox({
      prelude: '',
      code: `${code}\nreturn __ob.run(${JSON.stringify(inputJson)});`,
      hostCall: async () => ({ ok: false, error: { code: 'no_host', message: 'no host' } }),
      timeoutMs: 30_000,
      maxResultBytes: 16 * 1024 * 1024,
    });
    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
    expect(r.result).toBe(reference);
  }, 60_000);
});
