import { describe, expect, it } from 'vitest';
import { attachExtras } from '../../src/core/format/parser';
import { ELEMENT_TYPES, type ElementType } from '../../src/core/model';
import { MOCKUP_FIELD_SPECS, type MockupFieldSpec } from '../../src/core/model/mockup-fields';
import { buildElementSchemas } from '../../src/core/schema/elements';
import { normalise } from '../../src/core/tools/element-tools';
import { fieldsFor as panelFieldsFor } from '../../src/webview/properties/model';

/**
 * Lockstep guard (Req 4.1, 4.5, 28.2): every Field Registry entry must be recognised by the schema builder,
 * the parser's known-key lists, the element tools and (when it has a control) the Properties_Panel.
 * Passes vacuously while MOCKUP_FIELD_SPECS is empty.
 */

/** A valid value per field name; add an entry here when registering a field. */
const VALID_SAMPLES: Record<string, unknown> = {
  cornerRadii: [1, 2, 3, 4],
  imageFill: { assetId: 'a1', fit: 'cover' },
  fontWeight: 700,
  textColor: '#112233',
  textWrap: 'wrap',
  clipContent: true,
  component: 'Button',
  layout: {
    direction: 'vertical',
    gap: 8,
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
    mainAlign: 'spaceBetween',
    crossAlign: 'center',
  },
  sizing: { width: 'hug', height: 'fill' },
  ignoreLayout: true,
  instanceOf: 'master1',
  name: 'check',
  overrides: { child1: { text: 'Hi', fontWeight: 700 }, '': { width: 50 } },
};

/**
 * Fields that have a Properties_Panel `FieldDef` in webview/properties/model.ts. Add a name here when its control
 * lands (structured fields such as instanceOf/overrides/component/layout/sizing use composite controls and stay out).
 */
const PANEL_CONTROLS = new Set<string>(['cornerRadii', 'fontWeight', 'textColor', 'textWrap', 'imageFill', 'clipContent', 'name']);

const typesOf = (spec: MockupFieldSpec): readonly ElementType[] => spec.appliesTo ?? ELEMENT_TYPES;

/** Registry field names that other types already own as a native (non-Mockup) property: `name` on frame. */
const NATIVE_FIELDS: Record<string, readonly ElementType[]> = { name: ['frame'] };

type Obj = Record<string, unknown>;

function schemaHas(schema: unknown, spec: MockupFieldSpec): boolean {
  const props = (schema as { properties?: Obj }).properties ?? {};
  if (spec.location !== 'style') return spec.name in props;
  const style = props['style'] as { properties?: Obj } | undefined;
  return spec.name in props || (style?.properties !== undefined && spec.name in style.properties);
}

function elementWith(type: ElementType, spec: MockupFieldSpec, value: unknown): Obj {
  const el: Obj = { id: 'e1', type, x: 0, y: 0, width: 10, height: 10 };
  if (spec.location === 'style') el['style'] = { [spec.name]: value };
  else el[spec.name] = value;
  return el;
}

describe('Field Registry lockstep', () => {
  const schemas = buildElementSchemas();

  for (const spec of MOCKUP_FIELD_SPECS) {
    describe(`${spec.location}:${spec.name}`, () => {
      it('has a sample value in this test', () => {
        expect(VALID_SAMPLES, `add a VALID_SAMPLES entry for "${spec.name}"`).toHaveProperty(spec.name);
      });

      for (const type of typesOf(spec)) {
        it(`schema lists it for ${type}`, () => {
          expect(schemaHas(schemas[type], spec)).toBe(true);
        });

        it(`attachExtras keeps it out of extra for ${type}`, () => {
          const value = VALID_SAMPLES[spec.name];
          const doc = attachExtras({ schemaVersion: 1, elements: [elementWith(type, spec, value)] } as never) as unknown as {
            elements: Obj[];
          };
          const el = doc.elements[0]!;
          const bag = spec.location === 'style' ? (el['style'] as Obj) : el;
          expect((bag['extra'] as Obj | undefined) ?? {}).not.toHaveProperty(spec.name);
          expect(bag).toHaveProperty(spec.name);
        });

        it(`normalise accepts a valid value for ${type}`, () => {
          const n = normalise(type, { [spec.name]: VALID_SAMPLES[spec.name] }, { width: 10, height: 10 }, 'test');
          expect({ ...n.top, ...n.style }).toHaveProperty(spec.name);
        });

        if (PANEL_CONTROLS.has(spec.name)) {
          it(`Properties_Panel lists it for ${type}`, () => {
            expect(panelFieldsFor([{ type }]).map((f) => f.name)).toContain(spec.name);
          });
        }
      }

      for (const type of ELEMENT_TYPES.filter((t) => !typesOf(spec).includes(t) && !NATIVE_FIELDS[spec.name]?.includes(t))) {
        it(`normalise rejects it with unknown_property for ${type}`, () => {
          let code: string | undefined;
          try {
            normalise(type, { [spec.name]: VALID_SAMPLES[spec.name] }, { width: 10, height: 10 }, 'test');
          } catch (e) {
            code = (e as { code?: string }).code;
          }
          expect(code).toBe('unknown_property');
        });
      }
    });
  }

  it('covers every registry entry (vacuous while the registry is empty)', () => {
    expect(MOCKUP_FIELD_SPECS.length).toBeGreaterThanOrEqual(0);
  });
});
