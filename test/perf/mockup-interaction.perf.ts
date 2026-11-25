/**
 * Mockup-feature interaction benchmarks (task 26.4): 5,000-element open (Req 27.2), drag fps (Req 27.2),
 * token resolution overhead (Req 27.3), Text_Measurer and wrap re-render (Req 8.7, 8.9, 27.4).
 * Node proxies: pure core + projection, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/format/parser';
import type { Element } from '../../src/core/model/types';
import { measure } from '../../src/core/text/measure';
import { resolveTokens, resolveTokenValue } from '../../src/core/tokens/resolve';
import { toReactFlow, type ElementPreview } from '../../src/webview/canvas/project';
import { getBoardValidator } from '../helpers/validator';
import { BUDGETS, report, sample, time } from './harness';
import { generateMockupFieldElements, generateTokenElements } from './fixtures';

const validator = getBoardValidator();
const SCREEN = { width: 1200, height: 800 };
const VIEWPORT = { x: 0, y: 0, zoom: 1 };
const FRAMES = 60;

describe('mockup interaction benchmarks', () => {
  it('opens a 5,000-element mockup board within 3 s (Req 27.2)', async () => {
    const { text, bytes } = generateMockupFieldElements(5000);
    const open = (): number => {
      const r = parse(text, { validator });
      if (!r.ok) throw new Error('fixture failed to parse');
      return toReactFlow(r.doc, { viewport: VIEWPORT, screen: SCREEN }).nodes.length;
    };
    let nodes = 0;
    const runs = await time(5, () => (nodes = open()), 1);
    expect(nodes).toBeGreaterThan(0);
    const m = report(`mockup open 5000 elements (${bytes} B)`, '27.2', runs, BUDGETS.openMs5000Elements, 'parse+project only');
    expect(m.pass).toBe(true);
  });

  it('drag runs at no less than 30 fps on a 5,000-element mockup board (Req 27.2)', async () => {
    const { doc } = generateMockupFieldElements(5000);
    const selected = doc.elements.slice(0, 50);
    const selection = new Set(selected.map((e) => e.id));
    const view = { viewport: VIEWPORT, screen: SCREEN };
    const frame = (): number => {
      const t = performance.now();
      for (let i = 0; i < FRAMES; i++) {
        const previews = new Map<string, ElementPreview>();
        for (const e of selected) previews.set(e.id, { x: e.x + i * 3, y: e.y + i * 2 });
        toReactFlow(doc, view, { selection, previews });
      }
      return (performance.now() - t) / FRAMES;
    };
    const runs = await sample(5, frame, 1);
    const m = report('mockup drag frame (50 selected, 5000 el)', '27.2', runs, BUDGETS.frameMs, 'per-frame CPU proxy; >=30 fps');
    expect(m.pass).toBe(true);
  });

  it('token resolution costs at most 1 ms per 1,000 elements (Req 27.3)', async () => {
    const { doc } = generateTokenElements(1000);
    const tokens = (doc as { tokens?: Parameters<typeof resolveTokens>[0] }).tokens;
    const resolveAll = (): number => {
      const resolved = resolveTokens(tokens, 'light');
      let n = 0;
      for (const el of doc.elements) {
        if (resolveTokenValue(resolved, 'colors', el.style.fill ?? '') !== undefined) n++;
        if (resolveTokenValue(resolved, 'colors', el.style.stroke ?? '') !== undefined) n++;
      }
      return n;
    };
    expect(resolveAll()).toBe(2000);
    const runs = await time(11, resolveAll, 3);
    const m = report('token resolution (1000 el)', '27.3', runs, 1, 'resolveTokens + fill/stroke lookups');
    expect(m.pass).toBe(true);
  });

  it('Text_Measurer handles 10,000 characters within 20 ms (Req 8.7, 27.4)', async () => {
    const text = Array.from({ length: 1700 }, (_, i) => `word${i % 97}`).join(' ').slice(0, 10_000);
    expect(text.length).toBe(10_000);
    const run = (): number => {
      const r = measure({ text, fontFamily: 'sans-serif', fontSize: 16, fontWeight: 700, availableWidth: 400 });
      if (!r.ok) throw new Error(r.error);
      return r.value.lines.length;
    };
    expect(run()).toBeGreaterThan(1);
    const runs = await time(5, run, 2);
    const m = report('text measure 10,000 chars', '8.7, 27.4', runs, 20);
    expect(m.pass).toBe(true);
  });

  it('wrap toggle re-render (re-measure + re-project) within 100 ms (Req 8.9, 27.4)', async () => {
    const { doc } = generateMockupFieldElements(5000);
    const texts = doc.elements.filter((e) => e.type === 'text');
    let wrap = false;
    const toggle = (): number => {
      wrap = !wrap;
      const elements: Element[] = doc.elements.map((e) =>
        e.type === 'text' ? ({ ...e, textWrap: wrap ? 'wrap' : 'nowrap' } as Element) : e,
      );
      let lines = 0;
      for (const e of elements) {
        if (e.type !== 'text') continue;
        const r = measure({
          text: e.runs.map((x) => x.text).join(''),
          fontFamily: e.fontFamily,
          fontSize: e.fontSize,
          availableWidth: wrap ? e.width : Infinity,
        });
        if (r.ok) lines += r.value.lines.length;
      }
      toReactFlow({ ...doc, elements }, { viewport: VIEWPORT, screen: SCREEN });
      return lines;
    };
    expect(texts.length).toBeGreaterThan(0);
    const runs = await time(5, toggle, 2);
    const m = report('wrap toggle re-render (2500 texts)', '8.9, 27.4', runs, 100, 'measure + projection; no DOM');
    expect(m.pass).toBe(true);
  });
});
