/** Open-time proxy (Req 2.1, 17.1, 17.5, 17.6): parse + toReactFlow projection + culling in Node. */
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/format/parser';
import { toReactFlow } from '../../src/webview/canvas/project';
import { BoardDocumentState } from '../../src/host/editor/state';
import { loadFromBytes } from '../../src/host/editor/loader';
import { getBoardValidator } from '../helpers/validator';
import { BUDGETS, record, report, time } from './harness';
import { generateBoard, MB } from './fixtures';

const validator = getBoardValidator();
const SCREEN = { width: 1200, height: 800 };
const VIEWPORT = { x: 0, y: 0, zoom: 1 };

function openOnce(text: string): number {
  const r = parse(text, { validator });
  if (!r.ok) throw new Error('fixture failed to parse');
  return toReactFlow(r.doc, { viewport: VIEWPORT, screen: SCREEN }).nodes.length;
}

describe('open time (Node proxy for Req 2.1 / 17.1)', () => {
  for (const mb of [1, 3, 5]) {
    it(`parse + project + cull a ${mb} MB board`, async () => {
      const { text, bytes, doc } = generateBoard({ elements: 2000, targetBytes: mb * MB });
      expect(bytes).toBeGreaterThan(mb * MB * 0.9);
      let nodes = 0;
      const runs = await time(5, () => (nodes = openOnce(text)), 1);
      expect(nodes).toBeGreaterThan(0);
      expect(nodes).toBeLessThan(doc.elements.length);
      // Req 2.1: boards up to 5 MB open within 2 s.
      const m = report(`open ${mb} MB (${bytes} B, 2000 el)`, '2.1, 17.1', runs, BUDGETS.openMs5MB, 'parse+project only; no DOM/ReactFlow');
      expect(m.pass).toBe(true);
    });
  }

  it('parse + project + cull a 5,000-element board (Req 17.1)', async () => {
    const { text, bytes } = generateBoard({ elements: 5000 });
    const runs = await time(5, () => openOnce(text), 1);
    const m = report(`open 5000 elements (${bytes} B)`, '17.1', runs, BUDGETS.openMs5000Elements, 'parse+project only; no DOM/ReactFlow');
    expect(m.pass).toBe(true);
  });

  it('5,000-element notice threshold: at 5,000 no notice, above 5,000 the board still opens with a notice (Req 17.5, 17.6)', () => {
    const state = (n: number) => {
      const { text } = generateBoard({ elements: n });
      return new BoardDocumentState('mem', loadFromBytes(new TextEncoder().encode(text), (t) => parse(t, { validator })));
    };
    const at = state(5000);
    const above = state(5001);
    expect(at.elementCount()).toBe(5000);
    expect(at.isLarge()).toBe(false);
    expect(above.elementCount()).toBe(5001);
    expect(above.isLarge()).toBe(true);
    record({ name: 'large-board notice threshold', requirement: '17.5, 17.6', at5000: at.isLarge(), at5001: above.isLarge() });
  });
});
