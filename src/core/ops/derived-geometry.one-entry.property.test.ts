import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { syncPass } from '../components/sync';
import { runDerivedGeometryPass } from './derived-geometry';
import { UndoHistory } from './history';
import { BoardModel } from './model';

/**
 * Feature: mockup-design-features, Property 24: One undo entry, pass idempotence
 * **Validates: Requirements 18.3, 18.5**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { rotation: 0, style };
const rect = (id: string, x: number, y: number, parentId: string): Element =>
  ({ id, type: 'rectangle', x, y, width: 10, height: 10, ...base, parentId }) as Element;
const frame = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, x, y, width: 100, height: 50, ...base, ...extra }) as Element;

const coord = fc.integer({ min: -200, max: 200 });
const masterSpec = fc.record({ x: coord, y: coord, kids: fc.array(fc.record({ x: coord, y: coord }), { maxLength: 3 }) });
const instSpec = fc.record({ of: fc.nat(3), x: coord, y: coord });
type Edit =
  | { kind: 'moveMaster'; m: number; dx: number }
  | { kind: 'resizeMaster'; m: number; w: number }
  | { kind: 'addKid'; m: number; x: number; y: number }
  | { kind: 'addInstance'; m: number; x: number; y: number }
  | { kind: 'removeInstance'; i: number };
const editSpec: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('moveMaster' as const), m: fc.nat(3), dx: fc.integer({ min: 1, max: 100 }) }),
  fc.record({ kind: fc.constant('resizeMaster' as const), m: fc.nat(3), w: fc.integer({ min: 101, max: 400 }) }),
  fc.record({ kind: fc.constant('addKid' as const), m: fc.nat(3), x: coord, y: coord }),
  fc.record({ kind: fc.constant('addInstance' as const), m: fc.nat(3), x: coord, y: coord }),
  fc.record({ kind: fc.constant('removeInstance' as const), i: fc.nat(3) }),
);

function build(masters: { x: number; y: number; kids: { x: number; y: number }[] }[], insts: { of: number; x: number; y: number }[]): BoardDocument {
  const els: Element[] = [];
  masters.forEach((m, mi) => {
    els.push(frame(`M${mi}`, m.x, m.y, { component: `C${mi}` }));
    m.kids.forEach((k, ki) => els.push(rect(`M${mi}k${ki}`, k.x, k.y, `M${mi}`)));
  });
  insts.forEach((i, ii) => els.push(frame(`I${ii}`, i.x, i.y, { instanceOf: `M${i.of % masters.length}` })));
  const doc = { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: els, assets: [], library: [] } as BoardDocument;
  return syncPass(doc).doc;
}

describe('Property 24: One undo entry, pass idempotence', () => {
  it('a transaction records exactly one undo entry, and the committed document is a pass fixed point', () => {
    fc.assert(
      fc.property(
        fc.array(masterSpec, { minLength: 1, maxLength: 3 }),
        fc.array(instSpec, { minLength: 1, maxLength: 3 }),
        editSpec,
        (masters, insts, edit) => {
          const pre = build(masters, insts);
          const history = new UndoHistory();
          const model = new BoardModel('/b.openboard', pre, { history, now: () => '2020-01-01T00:00:00.000Z' });
          const mi = (n: number): string => `M${n % masters.length}`;
          model.transact('edit', (tx) => {
            switch (edit.kind) {
              case 'moveMaster': {
                const el = tx.doc.elements.find((e) => e.id === mi(edit.m))!;
                tx.update(el.id, { x: el.x + edit.dx });
                break;
              }
              case 'resizeMaster':
                tx.update(mi(edit.m), { width: edit.w });
                break;
              case 'addKid':
                tx.create({ ...rect('new', edit.x, edit.y, mi(edit.m)) });
                break;
              case 'addInstance':
                tx.create({ ...frame('newInst', edit.x, edit.y, { instanceOf: mi(edit.m) }) } as never);
                break;
              case 'removeInstance':
                tx.remove(`I${edit.i % insts.length}`);
                break;
            }
          });
          const post = model.getDocument();

          // Edit plus derived changes share a single undo entry.
          expect(history.undoCount()).toBe(1);

          // Running the pass again on the committed document changes nothing.
          const again = runDerivedGeometryPass(post);
          expect(again.patches).toEqual([]);
          expect(again.changedIds).toEqual([]);
          expect(again.doc).toEqual(post);

          // One undo reverts both the edit and its derived geometry.
          expect(history.undo(model)).toBe(true);
          expect(history.canUndo()).toBe(false);
          expect(model.getDocument()).toEqual(pre);
        },
      ),
      { numRuns: 150 },
    );
  });
});
