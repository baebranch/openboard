import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DefaultToolRegistry, type ToolDefinition } from '../../src/core/tools/registry';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 14: Tool definitions satisfy size limits
// **Validates: Requirements 13.1**

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_.-'.split('');
const schema = { type: 'object' } as const;

const make = (name: string, description: string): ToolDefinition => ({
  name,
  description,
  inputSchema: schema as any,
  outputSchema: schema as any,
  boardResolution: 'none',
  handler: () => ({}),
});

const validName = fc
  .array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 64 })
  .map((a) => a.join(''));
const validDesc = fc.string({ minLength: 1, maxLength: 1000 });

const badNameLength = fc.oneof(
  fc.constant(''),
  fc.array(fc.constantFrom(...NAME_CHARS), { minLength: 65, maxLength: 120 }).map((a) => a.join('')),
);
const badNameChars = fc
  .tuple(validName, fc.string({ minLength: 1, maxLength: 1 }).filter((c) => !/[a-z0-9_.-]/.test(c)), fc.nat())
  .map(([n, c, i]) => {
    const pos = i % (n.length + 1);
    return n.slice(0, pos) + c + n.slice(pos);
  });
const badDesc = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1001, maxLength: 1500 }),
);

describe('Feature: openboard, Property 14: Tool definitions satisfy size limits', () => {
  it('every registered tool has a valid name, description and schemas', () => {
    const { registry } = buildFullRegistry();
    const names = registry.list();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const def = registry.def(name);
      expect(name.length).toBeGreaterThanOrEqual(1);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^[a-z0-9_.-]+$/);
      expect(def.description.length).toBeGreaterThanOrEqual(1);
      expect(def.description.length).toBeLessThanOrEqual(1000);
      expect(def.inputSchema).toBeTruthy();
      expect(def.outputSchema).toBeTruthy();
    }
  });

  it('register accepts names/descriptions within limits', () => {
    fc.assert(
      fc.property(validName, validDesc, (name, desc) => {
        const reg = new DefaultToolRegistry();
        reg.register(make(name, desc));
        expect(reg.list()).toEqual([name]);
      }),
      { numRuns: 100 },
    );
  });

  it('register rejects names outside limits', () => {
    fc.assert(
      fc.property(fc.oneof(badNameLength, badNameChars), validDesc, (name, desc) => {
        const reg = new DefaultToolRegistry();
        expect(() => reg.register(make(name, desc))).toThrow();
        expect(reg.list()).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('register rejects descriptions outside limits', () => {
    fc.assert(
      fc.property(validName, badDesc, (name, desc) => {
        const reg = new DefaultToolRegistry();
        expect(() => reg.register(make(name, desc))).toThrow();
        expect(reg.list()).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
