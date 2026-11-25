/** Smoke test: every mockup arbitrary yields documents that satisfy the model invariants and the schema. */
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncPass, ComponentCycleError } from '../../src/core/components/sync';
import { effectiveSchemaVersion, parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { DOCUMENT_FIELD_SPECS, MOCKUP_FIELD_SPECS } from '../../src/core/model/mockup-fields';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { checkInvariants } from '../../src/core/ops/invariants';
import { runDerivedGeometryPass } from '../../src/core/ops/derived-geometry';
import { getBoardValidator } from '../helpers/validator';
import {
  arbComponentCycleDocument,
  arbComponentNestingDocument,
  arbLayoutTreeDocument,
  arbMockupBoardDocument,
  arbNestedFrameDocument,
  arbSchemaV1Document,
  arbSchemaV2Document,
} from './index';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

const RUNS = { numRuns: 25 };

function expectValid(doc: BoardDocument): void {
  expect(checkInvariants(doc)).toEqual([]);
  const parsed = parse(serialize(doc), { validator });
  expect(parsed.ok).toBe(true);
  // A stored version 1 file opens as version 2 in memory (Req 3.7); everything else is unchanged.
  if (parsed.ok) expect({ ...parsed.doc, schemaVersion: doc.schemaVersion }).toEqual(doc);
  expect(doc.schemaVersion).toBe(effectiveSchemaVersion(doc));
}

function chainDepth(doc: BoardDocument, start: Element, next: (e: Element) => string | undefined): number {
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  let depth = 1;
  let cur: Element | undefined = start;
  while (cur) {
    const id = next(cur);
    cur = id === undefined ? undefined : byId.get(id);
    if (cur) depth++;
  }
  return depth;
}

describe('mockup arbitraries', () => {
  it('arbMockupBoardDocument is valid and sets every Mockup_Field', () => {
    fc.assert(
      fc.property(arbMockupBoardDocument(), (doc) => {
        expectValid(doc);
        expect(doc.schemaVersion).toBe(2);
        expect(Object.keys(doc.tokens ?? {}).sort()).toEqual(['colors', 'fonts', 'numbers']);
        for (const spec of [...MOCKUP_FIELD_SPECS, ...DOCUMENT_FIELD_SPECS]) {
          const present =
            spec.name === 'tokens'
              ? doc.tokens !== undefined
              : doc.elements.some((e) => {
                  const r = e as unknown as Record<string, unknown>;
                  return spec.name in r || spec.name in e.style;
                });
          expect(present, `field ${spec.name}`).toBe(true);
        }
        const out = runDerivedGeometryPass(doc);
        expect(checkInvariants(out.doc)).toEqual([]);
      }),
      RUNS,
    );
  });

  it('arbSchemaV1Document needs no Schema_V2_Feature', () => {
    fc.assert(
      fc.property(arbSchemaV1Document(), (doc) => {
        expect(doc.schemaVersion).toBe(1);
        expect(effectiveSchemaVersion(doc)).toBe(1);
        expect(checkInvariants(doc)).toEqual([]);
        const parsed = parse(serialize(doc), { validator });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        // A version 1 file opens as version 2 in memory and saves back as version 1 (Req 3.7).
        expect(parsed.doc.schemaVersion).toBe(2);
        expect(serialize(parsed.doc)).toBe(serialize(doc));
      }),
      RUNS,
    );
  });

  it('arbSchemaV2Document needs Schema_Version 2', () => {
    fc.assert(
      fc.property(arbSchemaV2Document(), (doc) => {
        expectValid(doc);
        expect(doc.schemaVersion).toBe(2);
      }),
      RUNS,
    );
  });

  it('arbNestedFrameDocument nests frames at least 3 deep', () => {
    fc.assert(
      fc.property(arbNestedFrameDocument(), (doc) => {
        expectValid(doc);
        const kids = new Map<string, Element>();
        for (const e of doc.elements) if (e.type === 'frame' && e.parentId !== undefined) kids.set(e.parentId, e);
        const root = doc.elements.find((e) => e.id === 'nf-0')!;
        expect(chainDepth(doc, root, (e) => kids.get(e.id)?.id)).toBeGreaterThanOrEqual(3);
      }),
      RUNS,
    );
  });

  it('arbComponentNestingDocument nests components at least 3 deep and passes derived geometry', () => {
    fc.assert(
      fc.property(arbComponentNestingDocument(), (doc) => {
        expectValid(doc);
        const top = doc.elements.find((e) => e.id === 'cn-I')!;
        const insideMaster = (e: Element): string | undefined => {
          const m = doc.elements.find((x) => x.id === (e as { instanceOf?: string }).instanceOf);
          if (m === undefined) return undefined;
          const inner = doc.elements.find((x) => x.type === 'frame' && x.parentId === m?.id && x.instanceOf !== undefined);
          return inner?.id ?? m?.id;
        };
        expect(chainDepth(doc, top, insideMaster)).toBeGreaterThanOrEqual(3);
        const out = runDerivedGeometryPass(doc);
        expect(checkInvariants(out.doc)).toEqual([]);
        expect(out.doc.elements.some((e) => e.id.startsWith('cn-I::'))).toBe(true);
      }),
      RUNS,
    );
  });

  it('arbComponentCycleDocument is structurally valid but cyclic', () => {
    fc.assert(
      fc.property(arbComponentCycleDocument(), (doc) => {
        expectValid(doc);
        expect(() => syncPass(doc)).toThrow(ComponentCycleError);
      }),
      RUNS,
    );
  });

  it('arbLayoutTreeDocument mixes sizing modes and passes derived geometry', () => {
    fc.assert(
      fc.property(arbLayoutTreeDocument(), (doc) => {
        expectValid(doc);
        expect(doc.elements.some((e) => e.type === 'frame' && e.layout !== undefined)).toBe(true);
        expect(doc.elements.some((e) => e.sizing !== undefined)).toBe(true);
        const out = runDerivedGeometryPass(doc);
        expect(checkInvariants(out.doc)).toEqual([]);
      }),
      RUNS,
    );
  });
});
