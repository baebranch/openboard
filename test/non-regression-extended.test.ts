import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/core/format/parser';
import { serialize } from '../src/core/format/serializer';
import { recomputeAttachedEdges } from '../src/core/flow/routing';
import { runDerivedGeometryPass } from '../src/core/ops/derived-geometry';
import { BoardModel } from '../src/core/ops/model';
import type { ElementInput } from '../src/core/ops';
import type { BoardDocument } from '../src/core/model/types';
import { getBoardValidator } from './helpers/validator';

// Task 27.12 (Req 2.4, 2.8, 2.12, 28.6): Edge re-routing stays within 100 ms on a 500-element board
// for Frame, Instance_Child and Layout_Frame child changes, and pre-feature inputs behave unchanged.

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const lay = { direction: 'horizontal', gap: 4, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start' };
const rect = (id: string, extra: Record<string, unknown> = {}): ElementInput =>
  ({ id, type: 'rectangle', ...base, ...extra }) as ElementInput;
const frame = (id: string, extra: Record<string, unknown> = {}): ElementInput =>
  ({ id, type: 'frame', name: id, ...base, width: 400, height: 100, ...extra }) as ElementInput;
const edge = (id: string, s: string, t: string): ElementInput =>
  ({ id, type: 'edge', ...base, sourceId: s, targetId: t, routing: 'orthogonal', sourceArrow: 'none', targetArrow: 'arrow' }) as unknown as ElementInput;

const BUDGET_MS = 100;

function buildBoard(): BoardModel {
  const doc: BoardDocument = { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] };
  const model = new BoardModel('/b.openboard', doc, { now: () => '2024-01-01T00:00:00.000Z' });
  model.transact('seed', (tx) => {
    tx.create(frame('F', { x: 0, y: 0 }));
    tx.create(frame('L', { x: 0, y: 500, layout: lay }));
    tx.create(frame('M', { x: 0, y: 1000, component: 'Card' }));
    for (let i = 0; i < 20; i++) {
      tx.create(rect(`fc${i}`, { parentId: 'F', x: i * 12 }));
      tx.create(rect(`lc${i}`, { parentId: 'L' }));
      tx.create(rect(`mc${i}`, { parentId: 'M', x: i * 12 }));
    }
    tx.create(frame('I', { x: 600, y: 1000, instanceOf: 'M' }));
    for (let i = 0; i < 20; i++) tx.create(rect(`far${i}`, { x: 2000 + i * 20, y: 0 }));
    // Filler to exceed 500 elements: loose rectangles plus edges attached to every child kind.
    for (let i = 0; i < 330; i++) tx.create(rect(`fill${i}`, { x: 3000 + (i % 30) * 20, y: Math.floor(i / 30) * 20 }));
    for (let i = 0; i < 20; i++) {
      tx.create(edge(`ef${i}`, `fc${i}`, `far${i}`));
      tx.create(edge(`el${i}`, `lc${i}`, `far${i}`));
      tx.create(edge(`ei${i}`, `I::mc${i}`, `far${i}`));
      tx.create(edge(`em${i}`, `mc${i}`, `far${i}`));
    }
  });
  return model;
}

/** Edit, run the derived pass (inside transact), then re-route every Edge attached to a changed element. */
function timedEdit(model: BoardModel, edited: string, patch: Record<string, unknown>): { ms: number; routed: number } {
  const t0 = performance.now();
  model.transact('edit', (tx) => tx.update(edited, patch as never));
  const changed = new Set<string>([edited, ...model.takeLastDerivedIds()]);
  const routes = recomputeAttachedEdges(model.getDocument().elements, changed);
  return { ms: performance.now() - t0, routed: routes.size };
}

describe('Edge re-routing on a 500-element board (Req 2.4, 2.8, 2.12)', () => {
  it('builds a board of at least 500 elements', () => {
    expect(buildBoard().getDocument().elements.length).toBeGreaterThanOrEqual(500);
  });

  it('re-routes within 100 ms after a Frame child change', () => {
    const model = buildBoard();
    const { ms, routed } = timedEdit(model, 'fc3', { x: 40, y: 20 });
    expect(routed).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('re-routes within 100 ms after a Layout_Frame child change', () => {
    const model = buildBoard();
    const { ms, routed } = timedEdit(model, 'lc0', { width: 40 });
    expect(routed).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('re-routes within 100 ms after an Instance_Child change', () => {
    const model = buildBoard();
    // Resizing the master child propagates to the instance child through the Sync_Pass.
    const { ms, routed } = timedEdit(model, 'mc2', { width: 30 });
    expect(model.getDocument().elements.find((e) => e.id === 'I::mc2')!.width).toBe(30);
    expect(routed).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('inputs valid before this feature are unchanged (Req 28.6)', () => {
  const dir = join(__dirname, 'fixtures', 'non-regression');
  const names = readdirSync(dir)
    .filter((n) => /^[^.]+\.openboard$/.test(n))
    .map((n) => n.replace(/\.openboard$/, ''));

  it.each(names)('%s: derived pass is a no-op and the stored result is reproduced', (name) => {
    const r = parse(readFileSync(join(dir, `${name}.openboard`), 'utf8'), { validator: getBoardValidator() });
    if (!r.ok) throw new Error(`fixture ${name} failed to parse`);
    const out = runDerivedGeometryPass(r.doc);
    expect(out.patches).toEqual([]);
    expect(out.changedIds).toEqual([]);
    expect(serialize(out.doc)).toBe(readFileSync(join(dir, `${name}.serialized.openboard`), 'utf8'));
  });
});
