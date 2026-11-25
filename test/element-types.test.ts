/**
 * Per-element-type unit tests (Req 19.5): for every Element type, create, update,
 * serialize + parse round trip, and export, with equality assertions.
 */
import { describe, expect, it } from 'vitest';
import { serialize, parse, sha256OfBase64 } from '../src/core/format';
import { ELEMENT_TYPES, type Asset, type BoardDocument, type Element, type ElementType } from '../src/core/model';
import { renderToSvg } from '../src/core/export/svg';
import { DEFAULT_EXPORT_OPTIONS, prepareExport } from '../src/core/export/scope';
import { buildFullRegistry, emptyBoardDoc } from './helpers/registry';
import { getBoardValidator } from './helpers/validator';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const asset: Asset = {
  id: 'asset-1',
  mime: 'image/png',
  hash: sha256OfBase64(PNG_B64) ?? '',
  width: 1,
  height: 1,
  data: PNG_B64,
};

interface Case {
  /** Extra elements created first (companions) and the create-item for the type under test. */
  companions: Record<string, unknown>[];
  create: Record<string, unknown>;
  /** A representative property update. */
  set: Record<string, unknown>;
  /** Property expected on the element after update. */
  check: (el: Element) => unknown;
  expected: unknown;
  /** A string that must appear in the SVG for the element. */
  svgMarker: string;
  assets?: Asset[];
}

const box = { x: 10, y: 20, width: 120, height: 80 };

const CASES: Record<ElementType, Case> = {
  rectangle: { companions: [], create: { type: 'rectangle', ...box }, set: { width: 200 }, check: (e) => e.width, expected: 200, svgMarker: '<rect' },
  ellipse: { companions: [], create: { type: 'ellipse', ...box }, set: { width: 200 }, check: (e) => e.width, expected: 200, svgMarker: '<ellipse' },
  diamond: { companions: [], create: { type: 'diamond', ...box }, set: { width: 200 }, check: (e) => e.width, expected: 200, svgMarker: '<polygon' },
  line: { companions: [], create: { type: 'line', ...box }, set: { strokeWidth: 5 }, check: (e) => e.style.strokeWidth, expected: 5, svgMarker: 'data-id' },
  arrow: { companions: [], create: { type: 'arrow', ...box }, set: { strokeWidth: 5 }, check: (e) => e.style.strokeWidth, expected: 5, svgMarker: 'data-id' },
  freehand: {
    companions: [],
    create: { type: 'freehand', ...box, points: [{ x: 0, y: 0, p: 0.5 }, { x: 30, y: 40, p: 0.7 }, { x: 60, y: 10, p: 0.4 }] },
    set: { baseWidth: 6 },
    check: (e) => (e as { baseWidth: number }).baseWidth,
    expected: 6,
    svgMarker: '<line',
  },
  text: { companions: [], create: { type: 'text', ...box, text: 'Hello text' }, set: { text: 'Changed text' }, check: (e) => (e as { runs: { text: string }[] }).runs[0]?.text, expected: 'Changed text', svgMarker: 'Hello text' },
  image: { companions: [], create: { type: 'image', ...box, assetId: 'asset-1', alt: 'pic' }, set: { alt: 'new alt' }, check: (e) => (e as { alt?: string }).alt, expected: 'new alt', svgMarker: 'data:image/png;base64,', assets: [asset] },
  frame: { companions: [], create: { type: 'frame', ...box, name: 'My Frame' }, set: { name: 'Renamed' }, check: (e) => (e as { name: string }).name, expected: 'Renamed', svgMarker: 'My Frame' },
  sticky: { companions: [], create: { type: 'sticky', ...box, text: 'Sticky note' }, set: { text: 'Changed note' }, check: (e) => (e as { runs: { text: string }[] }).runs[0]?.text, expected: 'Changed note', svgMarker: 'Sticky note' },
  flowNode: { companions: [], create: { type: 'flowNode', ...box, text: 'Step one', preset: 'decision' }, set: { preset: 'process' }, check: (e) => (e as { preset: string }).preset, expected: 'process', svgMarker: 'Step one' },
  icon: { companions: [], create: { type: 'icon', ...box, name: 'check' }, set: { name: 'unknown-glyph' }, check: (e) => (e as { name: string }).name, expected: 'unknown-glyph', svgMarker: 'data-id' },
  edge: {
    companions: [
      { id: 'src', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      { id: 'dst', type: 'rectangle', x: 300, y: 200, width: 50, height: 50 },
    ],
    create: { type: 'edge', sourceId: 'src', targetId: 'dst', routing: 'straight' },
    set: { routing: 'orthogonal' },
    check: (e) => (e as { routing: string }).routing,
    expected: 'orthogonal',
    svgMarker: 'data-id',
  },
};

async function createElement(c: Case): Promise<{ r: ReturnType<typeof buildFullRegistry>; el: Element }> {
  const doc: BoardDocument = { ...emptyBoardDoc(), assets: c.assets ?? [] };
  const r = buildFullRegistry({ doc });
  if (c.companions.length > 0) {
    const res = (await r.registry.invoke('openboard.element.create', { elements: c.companions })) as { error?: unknown };
    expect(res.error).toBeUndefined();
  }
  const res = (await r.registry.invoke('openboard.element.create', { elements: [c.create] })) as {
    created?: Element[];
    error?: unknown;
  };
  expect(res.error).toBeUndefined();
  const el = res.created![0]!;
  return { r, el };
}

describe('per-element-type coverage guard', () => {
  it('has a case for every ELEMENT_TYPES entry and no extras', () => {
    expect(Object.keys(CASES).sort()).toEqual([...ELEMENT_TYPES].sort());
  });
});

describe.each(ELEMENT_TYPES.map((t) => [t] as const))('%s element', (type) => {
  const c = CASES[type];

  it('creates via openboard.element.create', async () => {
    const { r, el } = await createElement(c);
    expect(el.type).toBe(type);
    expect(el.id).toBeTruthy();
    expect(r.model.getDocument().elements.find((e) => e.id === el.id)).toEqual(el);
  });

  it('updates a representative property via openboard.element.update', async () => {
    const { r, el } = await createElement(c);
    const res = (await r.registry.invoke('openboard.element.update', { ids: [el.id], set: c.set })) as {
      updated?: number;
      error?: unknown;
    };
    expect(res.error).toBeUndefined();
    expect(res.updated).toBe(1);
    const after = r.model.getDocument().elements.find((e) => e.id === el.id)!;
    expect(c.check(after)).toEqual(c.expected);
  });

  it('serializes and parses back to an equal document', async () => {
    const { r } = await createElement(c);
    const doc = r.model.getDocument();
    expect(getBoardValidator()(JSON.parse(serialize(doc)))).toBe(true);
    const text = serialize(doc);
    const parsed = parse(text, { validator: getBoardValidator() });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.readOnly).toBe(false);
        // The parser migrates version 1 to 2 in memory (Req 3.5); everything else is unchanged.
    expect(parsed.doc).toEqual({ ...doc, schemaVersion: 2 });
    expect(serialize(parsed.doc)).toBe(text);
  });

  it('exports a non-empty self-contained SVG that mentions the element', async () => {
    const { r, el } = await createElement(c);
    const doc = r.model.getDocument();
    const out = renderToSvg(doc, { kind: 'selection', ids: [el.id] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { svg, width, height } = out.value;
    expect(svg.length).toBeGreaterThan(0);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain(`data-id="${el.id}"`);
    expect(svg).toContain(c.svgMarker);
    // Self-contained: no external references.
    expect(svg).not.toMatch(/(?:href|src)="(?!data:|#)/);
  });

  it('passes PNG-less export validation (prepareExport)', async () => {
    const { r, el } = await createElement(c);
    const doc = r.model.getDocument();
    for (const format of ['svg', 'png'] as const) {
      const prep = prepareExport(doc, { ...DEFAULT_EXPORT_OPTIONS, format, scope: { kind: 'selection', ids: [el.id] } });
      expect(prep.ok).toBe(true);
      if (!prep.ok) continue;
      expect(prep.value.elements.map((e) => e.id)).toContain(el.id);
      expect(prep.value.w).toBeGreaterThan(0);
      expect(prep.value.h).toBeGreaterThan(0);
    }
  });
});
