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
