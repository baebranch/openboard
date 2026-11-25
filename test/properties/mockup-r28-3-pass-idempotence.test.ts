import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ComponentCycleError, syncPass } from '../../src/core/components/sync';
import { runLayoutPass } from '../../src/core/layout/run-layout-pass';
import { DerivedGeometryError, runDerivedGeometryPass } from '../../src/core/ops/derived-geometry';
import type { BoardDocument } from '../../src/core/model/types';
import {
  arbComponentCycleDocument,
  arbComponentNestingDocument,
  arbLayoutTreeDocument,
  arbMockupBoardDocument,
  arbNestedFrameDocument,
} from '../arbitraries';

// Feature: mockup-design-features, Requirement 28.3: all three passes are idempotent and complete within 5 seconds.
const LIMIT_MS = 5000;
// Wall-clock budget for the whole 100-run property under a loaded parallel suite; the 5 s per-pass bound is still asserted in timed().
const TEST_TIMEOUT_MS = 60_000;
const RUNS = { numRuns: 100 };

const arbAcyclic: fc.Arbitrary<BoardDocument> = fc.oneof(
  arbMockupBoardDocument(15),
  arbComponentNestingDocument(3),
  arbNestedFrameDocument(3),
  arbLayoutTreeDocument(),
);

function timed<T>(fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  expect(performance.now() - t0).toBeLessThan(LIMIT_MS);
  return r;
}

describe('Feature: mockup-design-features, Requirement 28.3: pass idempotence and time bound', () => {
  it('Sync_Pass is idempotent and completes within 5 seconds', () => {
    // **Validates: Requirements 28.3**
    fc.assert(
      fc.property(arbAcyclic, (doc) => {
        const once = timed(() => syncPass(doc));
        const twice = timed(() => syncPass(once.doc));
        expect(twice.changedIds).toEqual([]);
        expect(twice.doc).toEqual(once.doc);
      }),
      RUNS,
    );
  }, TEST_TIMEOUT_MS);

  it('Layout_Pass is idempotent and completes within 5 seconds', () => {
    // **Validates: Requirements 28.3**
    fc.assert(
      fc.property(arbAcyclic, (doc) => {
        const once = timed(() => runLayoutPass(doc));
        const twice = timed(() => runLayoutPass(once.doc));
        expect(twice.changedIds).toEqual([]);
        expect(twice.doc).toEqual(once.doc);
      }),
      RUNS,
    );
  }, TEST_TIMEOUT_MS);

  it('Derived_Geometry_Pass is idempotent and completes within 5 seconds', () => {
    // **Validates: Requirements 28.3**
    fc.assert(
      fc.property(arbAcyclic, (doc) => {
        const once = timed(() => runDerivedGeometryPass(doc));
        const twice = timed(() => runDerivedGeometryPass(once.doc));
        expect(twice.changedIds).toEqual([]);
        expect(twice.doc).toEqual(once.doc);
      }),
      RUNS,
    );
  }, TEST_TIMEOUT_MS);

  it('a component cycle is rejected by the Sync_Pass and the Derived_Geometry_Pass within 5 seconds', () => {
    // **Validates: Requirements 28.3**
    fc.assert(
      fc.property(arbComponentCycleDocument(), (doc) => {
        expect(() => timed(() => syncPass(doc))).toThrow(ComponentCycleError);
        let err: unknown;
        try {
          timed(() => runDerivedGeometryPass(doc));
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(DerivedGeometryError);
        expect((err as DerivedGeometryError).reason).toBe('component-cycle');
      }),
      RUNS,
    );
  }, TEST_TIMEOUT_MS);
});
