import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { getBoardValidator } from '../../../test/helpers/validator';
import { arbMockupBoardDocument } from '../../../test/arbitraries';
import { documentFields, MOCKUP_FIELD_SPECS } from '../model/mockup-fields';
import { parse, setBoardValidator } from './parser';
import { serialize } from './serializer';

/**
 * Feature: mockup-design-features, Property 4: Unknown nested properties survive round trips
 * **Validates: Requirements 4.4, 28.2**
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every plain object inside layout, overrides and tokens structures of a raw document. */
function injectionTargets(raw: Obj): Obj[] {
  const out: Obj[] = [];
  const add = (v: unknown): void => {
    if (isObj(v)) out.push(v);
  };
  // Only structures whose schema allows extra properties: the token name maps and the
  // {light, dark} pair are closed by design, as is the overrides map keyed by element id.
  add(raw['tokens']);
  for (const el of (raw['elements'] as unknown[]) ?? []) {
    if (!isObj(el)) continue;
    if (isObj(el['layout'])) {
      add(el['layout']);
      add(el['layout']['padding']);
    }
    if (isObj(el['overrides'])) {
      for (const ov of Object.values(el['overrides'])) {
        add(ov);
        if (isObj(ov)) add(ov['imageFill']);
      }
    }
  }
  return out;
}

const FIELD_NAMES = new Set<string>([...MOCKUP_FIELD_SPECS.map((s) => s.name), ...documentFields()]);

/** Mockup_Field names found inside any `extra` bag (bags are opaque, not descended into). */
function fieldsInExtraBags(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => fieldsInExtraBags(x, `${path}/${i}`));
  if (!isObj(v)) return [];
  const bad: string[] = [];
  for (const [k, child] of Object.entries(v)) {
    if (k === 'extra' && isObj(child)) {
      for (const name of Object.keys(child)) if (FIELD_NAMES.has(name)) bad.push(`${path}/extra/${name}`);
    } else {
      bad.push(...fieldsInExtraBags(child, `${path}/${k}`));
    }
  }
  return bad;
}

describe('Feature: mockup-design-features, Property 4: Unknown nested properties survive round trips', () => {
  beforeAll(() => setBoardValidator(getBoardValidator()), 60_000);

  it('**Validates: Requirements 4.4, 28.2** injected unknown properties keep name and value; no Mockup_Field lands in an extra bag', () => {
    fc.assert(
      fc.property(
        arbMockupBoardDocument(5),
        fc.array(fc.tuple(fc.nat(), fc.stringMatching(/^[a-z]{1,8}$/), fc.jsonValue({ maxDepth: 3 })), { minLength: 1, maxLength: 6 }),
        (doc, injections) => {
          const raw = JSON.parse(serialize(doc)) as Obj;
          const targets = injectionTargets(raw);
          expect(targets.length).toBeGreaterThan(0);

          // Distinct, never-known names; later injections on the same target must not collide.
          const injected: { target: Obj; name: string; value: unknown }[] = [];
          injections.forEach(([i, suffix, value], n) => {
            const target = targets[i % targets.length]!;
            const name = `zzUnknown${n}${suffix}`;
            target[name] = value;
            // The expectation is the value as JSON text can carry it (e.g. -0 is written as 0).
            injected.push({ target, name, value: JSON.parse(JSON.stringify(value)) as unknown });
          });

          const first = parse(JSON.stringify(raw));
          expect(first.ok).toBe(true);
          if (!first.ok) return;
          expect(fieldsInExtraBags(first.doc)).toEqual([]);

          const text1 = serialize(first.doc);
          // Unknown properties are still in the serialized output with unchanged values.
          const once = JSON.parse(text1) as Obj;
          const onceTargets = injectionTargets(once);
          expect(onceTargets.length).toBe(targets.length);
          injected.forEach(({ target, name, value }) => {
            const idx = targets.indexOf(target);
            expect(onceTargets[idx]![name]).toEqual(value);
          });

          const second = parse(text1);
          expect(second.ok).toBe(true);
          if (!second.ok) return;
          expect(second.doc).toEqual(first.doc);
          expect(serialize(second.doc)).toBe(text1);
          expect(fieldsInExtraBags(second.doc)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
