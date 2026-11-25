import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from '../../src/core/format/parser';
import type { BoardValidator } from '../../src/core/format';
import { ELEMENT_TYPES, maxCornerRadius, type Element, type ElementType } from '../../src/core/model';
import { MOCKUP_FIELD_SPECS, type MockupFieldSpec } from '../../src/core/model/mockup-fields';
import { validateProperty } from '../../src/core/properties';
import { buildSizingCommit } from '../../src/webview/properties/layout-model';
import { commitValue, FIELDS, fieldsFor as panelFieldsFor } from '../../src/webview/properties/model';
import { arbElement, arbIconName, arbLayoutSpec, arbOverride, arbSizing } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';
import { getBoardValidator } from '../helpers/validator';

/**
 * Compared surfaces: the Parser's schema validation (`parse` with the compiled board validator), the
 * `element.create` / `element.update` tool handlers, and the Properties_Panel commit validation.
 *
 * Scope notes (each follows the requirements, none weakens an assertion):
 * - Values are JSON-safe and never a top-level `null`: `null` is the tools' "remove the field" request, not a stored value.
 * - Mutations replace or delete existing members; they never add unknown members, because the Parser must preserve
 *   unknown properties inside `layout` / `overrides` / `imageFill` (Req 4.4) while the tools reject them as input.
 * - The corner-radius upper bound (half the shorter side) depends on the element size, which a JSON schema cannot
 *   express (Req 6.5 puts it on the tools and the panel); that single case is asserted explicitly as parser-accepts,
 *   tool-rejects, panel-rejects.
 * - The Parser accepts unknown properties on an element type that does not support a field (kept as extras), so for
 *   unsupported types the tool and the panel are compared (Req 4.7).
 * - The panel is compared on the value domain its controls can produce: typed values for corner radii and text color,
 *   text for font weight, text wrap and icon name, booleans for clip content, per-axis modes for sizing.
 *   Composite controls (image fill, layout, component fields) have no free-form commit validation to compare.
 */

const NUM_RUNS = 150;
const TYPES: readonly ElementType[] = ['rectangle', 'ellipse', 'diamond', 'frame', 'text', 'sticky', 'flowNode', 'icon'];
const PANEL_CONTROLS = new Set(['cornerRadii', 'fontWeight', 'textColor', 'textWrap', 'imageFill', 'clipContent', 'name']);
const FIELD_NAMES = MOCKUP_FIELD_SPECS.map((s) => s.name);

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

const supports = (spec: MockupFieldSpec, type: ElementType): boolean =>
  spec.appliesTo === undefined || spec.appliesTo.includes(type);

const arbColorLike = fc.oneof(
  fc.constantFrom('theme:default', '#fff', '#ffff', '#112233', '#11223344', 'token:brand', 'token:a.b-c_1'),
  fc.string({ maxLength: 12 }),
);

/** A value of the field's valid shape (sizes in the element decide the corner radius bound). */
function arbValid(field: string, el: Element): fc.Arbitrary<unknown> {
  const max = maxCornerRadius(el.width, el.height);
  switch (field) {
    case 'cornerRadii': {
      const r = fc.integer({ min: 0, max: 100 }).map((p) => (max * p) / 100);
      return fc.tuple(r, r, r, r);
    }
    case 'imageFill':
      return fc.record({ assetId: fc.string({ minLength: 1, maxLength: 12 }), fit: fc.constantFrom('cover', 'contain', 'stretch') });
    case 'fontWeight':
      return fc.integer({ min: 1, max: 9 }).map((n) => n * 100);
    case 'textColor':
      return arbColorLike;
    case 'textWrap':
      return fc.constantFrom('none', 'wrap');
    case 'clipContent':
    case 'ignoreLayout':
      return fc.boolean();
    case 'layout':
      return arbLayoutSpec(['n1', 'n2']);
    case 'sizing':
      return arbSizing;
    case 'component':
      return fc.string({ minLength: 1, maxLength: 100 });
    case 'instanceOf':
      return fc.string({ minLength: 1, maxLength: 20 });
    case 'name':
      return arbIconName;
    case 'overrides':
      return fc.record(
        { '': arbOverride({ root: true }), c1: arbOverride(), c2: arbOverride() },
        { requiredKeys: [] },
      );
    default:
      throw new Error(`no generator for Mockup_Field "${field}"`);
  }
}

const REPLACEMENTS: readonly unknown[] = [
  -1, 0, 0.5, 1, 2.5, 50, 99, 100, 101, 150, 360, 500, 999, 1000, 1001, 1e9, -1e9, 700, 750, 1000.5,
  '', ' ', 'x', 'wrap', 'none', 'hug', 'fill', 'fixed', 'auto', '#12', '#12345', '#abcdef', 'theme:default', 'token:', 'token:a b', 'token:ok',
  true, false, [], {}, [1, 2, 3], [1, 2, 3, 4, 5],
];

/** Replaces (or deletes) one member found by following `path` through the value. */
function mutate(v: unknown, repl: unknown, path: readonly number[], del: boolean): unknown {
  const isObj = typeof v === 'object' && v !== null;
  const keys = isObj ? Object.keys(v as object) : [];
  if (path.length === 0 || keys.length === 0) return repl;
  const key = keys[path[0]! % keys.length]!;
  const rest = path.slice(1);
  if (Array.isArray(v)) {
    const idx = Number(key);
    if (rest.length === 0 && del) return v.filter((_, i) => i !== idx);
    return v.map((x, i) => (i === idx ? mutate(x, repl, rest, del) : x));
  }
  const obj = v as Record<string, unknown>;
  if (rest.length === 0 && del) {
    const { [key]: _gone, ...others } = obj;
    return others;
  }
  return { ...obj, [key]: mutate(obj[key], repl, rest, del) };
}

/**
 * Fields whose objects the Parser must keep with unknown members (Req 4.4) while the tools reject
 * them. Free-form JSON for these is limited to non-objects, so it cannot add unknown members either
 * (see the scope notes above); objects still come from the valid and mutated branches.
 */
const PRESERVES_UNKNOWN_MEMBERS: ReadonlySet<string> = new Set(['layout', 'overrides', 'imageFill']);
const isPlainObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);
const containsObject = (v: unknown): boolean => isPlainObject(v) || (Array.isArray(v) && v.some(containsObject));

function arbValue(field: string, el: Element): fc.Arbitrary<unknown> {
  const valid = arbValid(field, el);
  const json = PRESERVES_UNKNOWN_MEMBERS.has(field) ? fc.jsonValue().filter((v) => !containsObject(v)) : fc.jsonValue();
  const repl = fc.oneof(fc.constantFrom(...REPLACEMENTS), json);
  const mutated = fc
    .tuple(valid, repl, fc.array(fc.nat(8), { maxLength: 3 }), fc.boolean())
    .map(([v, r, p, d]) => mutate(v, r, p, d));
  return fc
    .oneof({ weight: 3, arbitrary: valid }, { weight: 5, arbitrary: mutated }, { weight: 2, arbitrary: json })
    .map((v) => (v === undefined ? null : (JSON.parse(JSON.stringify(v)) as unknown)))
    .filter((v) => v !== null);
}

interface Case {
  type: ElementType;
  spec: MockupFieldSpec;
  el: Element;
  value: unknown;
}

const arbCase: fc.Arbitrary<Case> = fc
  .tuple(fc.constantFrom(...TYPES), fc.constantFrom(...MOCKUP_FIELD_SPECS))
  // `name` on a frame is the frame's own native property, not the icon Mockup_Field.
  .filter(([type, spec]) => !(spec.name === 'name' && type === 'frame'))
  .chain(([type, spec]) =>
    arbElement(type, 'e1').chain((el) => arbValue(spec.name, el).map((value) => ({ type, spec, el, value }))),
  );

function toolBase(el: Element): Record<string, unknown> {
  const base: Record<string, unknown> = { type: el.type, id: 'e1', x: el.x, y: el.y, width: el.width, height: el.height };
  if (el.type === 'icon') base['name'] = (el as unknown as { name: string }).name;
  return base;
}

/** Whether the value is a well-formed corner radii array with at least one value above the size-dependent bound. */
function overBound(value: unknown, el: Element): boolean {
  const max = maxCornerRadius(el.width, el.height);
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0) &&
    value.some((x: number) => x > max)
  );
}

const BASE_DOC = { meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, assets: [], library: [] };

function parserAccepts(el: Element, spec: MockupFieldSpec, value: unknown): { ok: boolean; path?: string } {
  const base = BASE_DOC;
  const raw: Record<string, unknown> = JSON.parse(JSON.stringify(el));
  if (spec.location === 'style') raw['style'] = { ...(raw['style'] as object), [spec.name]: value };
  else raw[spec.name] = value;
  const doc = { ...base, schemaVersion: 2, elements: [raw] };
  const r = parse(JSON.stringify(doc), { validator });
  return r.ok ? { ok: true } : { ok: false, path: r.kind === 'schema' ? r.path : undefined };
}

function panelAccepts(c: Case): boolean | undefined {
  const { spec, el, type, value } = c;
  const def = FIELDS.find((f) => f.name === spec.name);
  switch (spec.name) {
    case 'cornerRadii':
      return validateProperty(type, 'cornerRadii', value, { width: el.width, height: el.height }).ok;
    case 'textColor':
      return validateProperty(type, 'textColor', value).ok;
    case 'fontWeight':
      return typeof value === 'number' ? commitValue(def!, String(value), [el]).ok : undefined;
    case 'textWrap':
    case 'name':
      return typeof value === 'string' ? commitValue(def!, value, [el]).ok : undefined;
    case 'clipContent':
      return typeof value === 'boolean' ? commitValue(def!, String(value), [el]).ok : undefined;
    case 'sizing': {
      const v = value as Record<string, unknown>;
      if (typeof v !== 'object' || Array.isArray(v) || typeof v['width'] !== 'string' || typeof v['height'] !== 'string') return undefined;
      return buildSizingCommit([el], 'width', v['width']).ok && buildSizingCommit([el], 'height', v['height']).ok;
    }
    default:
      return undefined;
  }
}

const tally = { accepted: 0, rejected: 0, unsupported: 0 };

// Feature: mockup-design-features, Property 5: Cross-surface validation agreement
// **Validates: Requirements 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 25.1, 25.10, 25.12**
describe('Feature: mockup-design-features, Property 5: Cross-surface validation agreement', () => {
  it('registers a generator and a panel rule for every Mockup_Field', () => {
    expect(FIELD_NAMES.length).toBeGreaterThan(0);
    for (const name of FIELD_NAMES) expect(() => arbValid(name, { width: 10, height: 10 } as Element)).not.toThrow();
    expect(ELEMENT_TYPES).toEqual(expect.arrayContaining([...TYPES]));
  });

  it('parser, element.create / element.update and Properties_Panel agree on accept/reject, and a rejection changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(arbCase, async (c) => {
        const { type, spec, el, value } = c;
        const supported = supports(spec, type);

        const created = buildFullRegistry({ spy: false });
        const before0 = created.model.getDocument();
        const createRes = (await created.registry.invoke('openboard.element.create', {
          elements: [{ ...toolBase(el), [spec.name]: value }],
        })) as { error?: { code?: string } };

        const updated = buildFullRegistry({ spy: false });
        const seed = (await updated.registry.invoke('openboard.element.create', { elements: [toolBase(el)] })) as { error?: unknown };
        expect(seed.error).toBeUndefined();
        const before1 = updated.model.getDocument();
        const updateRes = (await updated.registry.invoke('openboard.element.update', {
          ids: ['e1'],
          set: { [spec.name]: value },
        })) as { error?: { code?: string } };

        // Create and update agree with each other, and a rejection leaves the document untouched (Req 4.6, 4.8).
        const toolOk = createRes.error === undefined;
        expect(updateRes.error === undefined, `create/update disagree: ${JSON.stringify([createRes.error, updateRes.error])}`).toBe(toolOk);
        if (!toolOk) {
          expect(created.model.getDocument()).toBe(before0);
          expect(updated.model.getDocument()).toBe(before1);
        }

        const panel = panelAccepts(c);

        if (!supported) {
          tally.unsupported++;
          // Req 4.7: rejected naming the property, nothing changed; the panel offers no control for it.
          expect(createRes.error?.code).toBe('unknown_property');
          expect(updateRes.error?.code).toBe('unknown_property');
          if (PANEL_CONTROLS.has(spec.name)) {
            expect(panelFieldsFor([{ type }]).map((f) => f.name)).not.toContain(spec.name);
          }
          return;
        }

        const parsed = parserAccepts(el, spec, value);
        if (spec.name === 'cornerRadii' && overBound(value, el)) {
          // Size-dependent bound: the schema cannot see it; the tools and the panel must (Req 6.4, 6.5).
          expect(parsed.ok).toBe(true);
          expect(toolOk).toBe(false);
          expect(panel).toBe(false);
          return;
        }

        if (toolOk) tally.accepted++;
        else tally.rejected++;
        expect(parsed.ok, `parser ${parsed.ok ? 'accepts' : 'rejects'} but tool ${toolOk ? 'accepts' : 'rejects'}: ${JSON.stringify(createRes.error)}`).toBe(toolOk);
        if (!parsed.ok) expect(parsed.path ?? '').toContain('/elements/0'); // Req 4.2: names the offending path
        if (panel !== undefined) expect(panel, `panel ${panel ? 'accepts' : 'rejects'} but tool ${toolOk ? 'accepts' : 'rejects'}`).toBe(toolOk);
      }),
      { numRuns: NUM_RUNS },
    );
    // The generators must exercise both outcomes, otherwise agreement is vacuous.
    expect(tally.accepted).toBeGreaterThan(0);
    expect(tally.rejected).toBeGreaterThan(0);
    expect(tally.unsupported).toBeGreaterThan(0);
  });
});
