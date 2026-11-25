/**
 * Interaction frame-budget proxies (Req 3.13, 17.3): per-frame CPU cost of the pure state math,
 * asserted against 1000/30 ms. Real rAF fps must be measured in the webview (README).
 */
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../src/core/model/types';
import { pan, zoomByFactor } from '../../src/core/viewport/viewport';
import { snapToAlignment } from '../../src/core/snap/snap';
import { toReactFlow, type ElementPreview } from '../../src/webview/canvas/project';
import { BUDGETS, report, sample } from './harness';
import { generateBoard } from './fixtures';

const SCREEN = { width: 1200, height: 800 };
const FRAMES = 120;

describe('frame-budget proxies', () => {
  it('pan/zoom frame: viewport update + projection + culling, 1,000 elements', async () => {
    const { doc } = generateBoard({ elements: 1000 });
    const frame = (): number => {
      let v: Viewport = { x: 0, y: 0, zoom: 1 };
      const t = performance.now();
      for (let i = 0; i < FRAMES; i++) {
        v = i % 2 ? zoomByFactor(v, { x: 600, y: 400 }, i % 4 === 1 ? 1.05 : 0.95) : pan(v, 12, 7);
        toReactFlow(doc, { viewport: v, screen: SCREEN });
      }
      return (performance.now() - t) / FRAMES;
    };
    const runs = await sample(5, frame, 1);
    expect(report('pan/zoom frame (1000 el)', '3.13', runs, BUDGETS.frameMs, 'per-frame CPU proxy').pass).toBe(true);
  });

  it('drag frame: preview recompute + projection + snapping, 200 selected elements', async () => {
    const { doc } = generateBoard({ elements: 1000 });
    const selected = doc.elements.filter((e) => e.type !== 'edge').slice(0, 200);
    const selection = new Set(selected.map((e) => e.id));
    const others = doc.elements.slice(200, 400).map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
    const view = { viewport: { x: 0, y: 0, zoom: 0.5 }, screen: SCREEN };
    const frame = (): number => {
      const t = performance.now();
      for (let i = 0; i < FRAMES; i++) {
        const dx = i * 3;
        const dy = i * 2;
        const previews = new Map<string, ElementPreview>();
        for (const e of selected) previews.set(e.id, { x: e.x + dx, y: e.y + dy });
        const first = selected[0]!;
        snapToAlignment({ x: first.x + dx, y: first.y + dy, width: first.width, height: first.height }, others, 0.5);
        toReactFlow(doc, view, { selection, previews });
      }
      return (performance.now() - t) / FRAMES;
    };
    const runs = await sample(5, frame, 1);
    expect(report('drag frame (200 selected, 1000 el)', '17.3', runs, BUDGETS.frameMs, 'per-frame CPU proxy').pass).toBe(true);
  });
});
