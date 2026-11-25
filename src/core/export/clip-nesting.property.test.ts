/**
 * Feature: mockup-design-features, Property 16: Nested clip intersection
 *
 * For any chain of nested Frames with `clipContent` set on some subset, a descendant's effective visible
 * region is the intersection of the clip shapes of every clipContent-enabled ancestor (and unclipped when
 * none are enabled). Checked structurally on the SVG: the descendant's wrapper `clip-path` must reference
 * the nearest clipping ancestor, and following `clip-path` links on each `<clipPath>` must visit exactly the
 * clipping ancestors, nearest to outermost, each defined with that frame's own geometry.
 *
 * **Validates: Requirements 10.2, 10.5, 10.8**
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import type { Element } from '../model/types';
import { renderToSvg } from './svg';

const style = { fill: '#ff0000', stroke: 'theme:default', strokeWidth: 0, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;

describe('Property 16: nested clip intersection', () => {
  it('descendant clip chain equals the clipContent-enabled ancestors, nearest to outermost', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), (flags) => {
        // flags[0] is the outermost frame; the leaf rectangle is inside the last frame.
        const els: Element[] = flags.map((clip, i) => ({
          id: `F${i}`,
          type: 'frame',
          name: `F${i}`,
          x: i * 10,
          y: i * 10 + 1,
          width: 500 - i * 20,
          height: 400 - i * 20,
          rotation: 0,
          style: { ...style },
          clipContent: clip,
          ...(i > 0 ? { parentId: `F${i - 1}` } : {}),
        })) as Element[];
        els.push({
          id: 'LEAF',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          style: { ...style },
          parentId: `F${flags.length - 1}`,
        } as Element);

        const r = renderToSvg({ elements: els, assets: [] }, { kind: 'board' });
        if (!r.ok) throw new Error('export failed');
        const svg = r.value.svg;

        const expected = flags.map((c, i) => (c ? `F${i}` : null)).filter((x): x is string => x !== null).reverse();

        // Parse clipPath definitions: id -> { parent clip id, raw body }.
        const defs = new Map<string, { parent?: string; body: string }>();
        for (const m of svg.matchAll(/<clipPath id="([^"]+)"(?: clip-path="url\(#([^)]+)\)")?>(.*?)<\/clipPath>/g)) {
          defs.set(m[1]!, { parent: m[2], body: m[3]! });
        }

        // The leaf is the red rect whose wrapper carries a clip-path (if any).
        // Frames render before the leaf; isolate the leaf's own wrapper as the last clip-path group.
        const wrappers = [...svg.matchAll(/<g clip-path="url\(#([^)]+)\)">/g)];
        const leafRef = expected.length ? wrappers[wrappers.length - 1]?.[1] : undefined;

        if (expected.length === 0) {
          if (defs.size !== 0) throw new Error('no clipPath expected when no frame clips');
          return;
        }
        const actual: string[] = [];
        let cur = leafRef;
        const seen = new Set<string>();
        while (cur) {
          if (seen.has(cur)) throw new Error('clip cycle');
          seen.add(cur);
          const d = defs.get(cur);
          if (!d) throw new Error(`missing clipPath ${cur}`);
          actual.push(cur.replace(/^clipc-/, ''));
          cur = d.parent;
        }
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`chain ${JSON.stringify(actual)} != expected ${JSON.stringify(expected)}`);
        }
        // Each definition uses its own frame's geometry.
        for (const id of expected) {
          const i = Number(id.slice(1));
          const body = defs.get(`clipc-${id}`)!.body;
          if (!body.includes(`x="${i * 10}"`) || !body.includes(`y="${i * 10 + 1}"`)) {
            throw new Error(`clipPath for ${id} has wrong geometry: ${body}`);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
