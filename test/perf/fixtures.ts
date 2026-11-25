/**
 * Deterministic board fixture generator for the perf suite (1 MB .. 5 MB, up to 5,000+ Elements).
 * Elements are laid out on a grid; padding is spread over sticky-note text so the canonical
 * serialized size lands on `targetBytes`.
 */
import { serialize } from '../../src/core/format/serializer';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { defaultStyle } from '../../src/core/shapes';

const STYLE = defaultStyle();
const COLS = 100;
const CELL = 220;

export interface FixtureOptions {
  /** Number of Elements (nodes plus edges). */
  elements: number;
  /** Approximate serialized size; text padding is added to reach it. 0 = no padding. */
  targetBytes?: number;
}

function build(count: number, pad: number): BoardDocument {
  const elements: Element[] = [];
  // ~10% of elements are edges between consecutive nodes.
  const edgeCount = Math.floor(count / 10);
  const nodeCount = count - edgeCount;
  for (let i = 0; i < nodeCount; i++) {
    const base = { id: `n${i}`, x: (i % COLS) * CELL, y: Math.floor(i / COLS) * CELL, width: 160, height: 100, rotation: 0, style: STYLE };
    if (i % 3 === 0) {
      elements.push({ ...base, type: 'sticky', runs: [{ text: `Note ${i} ` + 'x'.repeat(pad) }], fontFamily: 'sans-serif', fontSize: 16, align: 'left' });
    } else if (i % 3 === 1) {
      elements.push({ ...base, type: 'rectangle' });
    } else {
      elements.push({ ...base, type: 'ellipse' });
    }
  }
  for (let i = 0; i < edgeCount; i++) {
    elements.push({
      id: `e${i}`, type: 'edge', x: 0, y: 0, width: 1, height: 1, rotation: 0, style: STYLE,
      sourceId: `n${i}`, targetId: `n${i + 1}`, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow',
    });
  }
  return {
    schemaVersion: 1,
    meta: { id: 'perf-board', title: `Perf ${count}` },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
  };
}

export function generateBoard(opts: FixtureOptions): { doc: BoardDocument; text: string; bytes: number } {
  let doc = build(opts.elements, 0);
  let text = serialize(doc);
  if (opts.targetBytes) {
    const stickies = Math.ceil((opts.elements - Math.floor(opts.elements / 10)) / 3);
    const pad = Math.max(0, Math.floor((opts.targetBytes - Buffer.byteLength(text)) / Math.max(1, stickies)));
    doc = build(opts.elements, pad);
    text = serialize(doc);
  }
  return { doc, text, bytes: Buffer.byteLength(text) };
}

export const MB = 1024 * 1024;

// ---- Mockup-feature fixtures (Req 27.1, 27.2, 27.4) ----

type Fixture = { doc: BoardDocument; text: string; bytes: number };

function wrap(count: number, title: string, elements: Element[], extra: Partial<BoardDocument> = {}): Fixture {
  const doc: BoardDocument = {
    schemaVersion: 2,
    meta: { id: 'perf-board', title },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
    ...extra,
  };
  const text = serialize(doc);
  return { doc, text, bytes: Buffer.byteLength(text) };
}

function rect(id: string, x: number, y: number, extra: Record<string, unknown> = {}, style: Record<string, unknown> = {}): Element {
  return {
    id, type: 'rectangle', x, y, width: 80, height: 40, rotation: 0, style: { ...STYLE, ...style }, ...extra,
  } as Element;
}

function frame(id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): Element {
  return {
    id, type: 'frame', x, y, width: w, height: h, rotation: 0, style: STYLE, name: id, ...extra,
  } as Element;
}

const LAYOUT = {
  direction: 'vertical', gap: 8, padding: { top: 8, right: 8, bottom: 8, left: 8 }, mainAlign: 'start', crossAlign: 'start',
};

/** One master with `children` children plus `instances` Component_Instances of it. */
export function generateInstances(instances = 100, children = 20): Fixture {
  const elements: Element[] = [frame('master', 0, 0, 200, 40 * children, { component: 'Perf master' })];
  for (let c = 0; c < children; c++) elements.push(rect(`m-c${c}`, 0, c * 40, { parentId: 'master' }));
  for (let i = 0; i < instances; i++) {
    const x = ((i % COLS) + 1) * CELL;
    const y = Math.floor(i / COLS) * 1000;
    elements.push(frame(`inst${i}`, x, y, 200, 40 * children, { instanceOf: 'master', overrides: { 'm-c0': { fill: '#ff0000' } } }));
  }
  return wrap(elements.length, `Perf instances ${instances}x${children}`, elements);
}

/** `count` elements that each use Mockup_Fields (cornerRadii, fontWeight, textColor, textWrap, sizing). */
export function generateMockupFieldElements(count = 5000): Fixture {
  const elements: Element[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % COLS) * CELL;
    const y = Math.floor(i / COLS) * CELL;
    if (i % 2 === 0) {
      elements.push(rect(`r${i}`, x, y, { sizing: { width: 'fixed', height: 'fixed' } }, { cornerRadii: [4, 8, 12, 16] }));
    } else {
      elements.push({
        id: `t${i}`, type: 'text', x, y, width: 160, height: 40, rotation: 0, style: STYLE,
        runs: [{ text: `Text ${i}` }], fontFamily: 'sans-serif', fontSize: 16, align: 'left',
        fontWeight: 700, textColor: '#112233', textWrap: 'wrap',
      } as Element);
    }
  }
  return wrap(count, `Perf mockup fields ${count}`, elements);
}

/** `count` elements whose colors reference Tokens, plus the token collection. */
export function generateTokenElements(count = 1000): Fixture {
  const elements: Element[] = [];
  for (let i = 0; i < count; i++) {
    elements.push(rect(`k${i}`, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, {}, { fill: `token:c${i % 10}`, stroke: 'token:c0' }));
  }
  const colors: Record<string, { light: string; dark: string }> = {};
  for (let c = 0; c < 10; c++) colors[`c${c}`] = { light: '#aabbcc', dark: '#334455' };
  return wrap(count, `Perf tokens ${count}`, elements, { tokens: { colors } } as Partial<BoardDocument>);
}

/** One Layout_Frame with `children` direct children. */
export function generateLayoutChildren(children = 200): Fixture {
  const elements: Element[] = [frame('lf', 0, 0, 400, 2000, { layout: LAYOUT })];
  for (let i = 0; i < children; i++) elements.push(rect(`lc${i}`, 0, 0, { parentId: 'lf' }));
  return wrap(elements.length, `Perf layout children ${children}`, elements);
}

/** A layout subtree of `total` elements: nested Layout_Frames, each holding up to 9 leaves and one child frame. */
export function generateLayoutSubtree(total = 500): Fixture {
  const elements: Element[] = [];
  let depth = 0;
  let parent: string | undefined;
  while (elements.length < total) {
    const fid = `ls${depth}`;
    elements.push(frame(fid, 0, 0, 400, 400, { layout: LAYOUT, ...(parent ? { parentId: parent } : {}) }));
    for (let l = 0; l < 9 && elements.length < total; l++) elements.push(rect(`${fid}-l${l}`, 0, 0, { parentId: fid }));
    parent = fid;
    depth++;
  }
  return wrap(elements.length, `Perf layout subtree ${total}`, elements);
}
