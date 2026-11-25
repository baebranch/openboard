import { describe, expect, it } from 'vitest';
import { fieldsFor, isSchemaV2Field, MOCKUP_FIELD_SPECS } from './mockup-fields';
import { ELEMENT_TYPES } from './types';

describe('Field Registry', () => {
  it('every spec has a non-empty name, description and valueType', () => {
    for (const spec of MOCKUP_FIELD_SPECS) {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.description.trim().length).toBeGreaterThan(0);
      expect(spec.valueType.trim().length).toBeGreaterThan(0);
    }
  });

  it('fieldsFor only returns registered names at that location, filtered by appliesTo', () => {
    for (const location of ['base', 'style', 'type'] as const) {
      for (const type of [undefined, ...ELEMENT_TYPES]) {
        for (const name of fieldsFor(location, type)) {
          const spec = MOCKUP_FIELD_SPECS.find(
            (s) => s.name === name && s.location === location && (type === undefined || !s.appliesTo || s.appliesTo.includes(type)),
          );
          expect(spec).toBeDefined();
        }
      }
    }
  });

  it('isSchemaV2Field is false for pre-existing fields', () => {
    expect(isSchemaV2Field('fill')).toBe(false);
    expect(isSchemaV2Field('x')).toBe(false);
  });
});
