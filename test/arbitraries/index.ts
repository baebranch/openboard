/**
 * Shared fast-check arbitraries for the core model (Req 19.1).
 * Generated documents satisfy the model invariants: unique element ids,
 * edge endpoints exist (and are non-edge elements), parents are frames,
 * referenced assets exist, and all numeric values are inside their ranges.
 */
import fc from 'fast-check';
import {
  ALT_TEXT_MAX,
  COORD_RANGE,
  CURRENT_SCHEMA_VERSION,
  EDGE_LABEL_MAX,
  FONT_SIZE_RANGE,
  FREEHAND_BASE_WIDTH_RANGE,
  MIN_SIZE,
  OPACITY_RANGE,
  ROTATION_RANGE,
  STROKE_WIDTH_RANGE,
  ZOOM_RANGE,
} from '../../src/core/model/ranges';
import type {
  ArrowHead,
  Asset,
  AssetMime,
  BoardDocument,
  Bounds,
  Color,
  EdgeRouting,
  Element,
  ElementBase,
  ElementStyle,
  ElementType,
  FlowNodePreset,
  FreehandPoint,
  TextProps,
  TextRun,
  Viewport,
} from '../../src/core/model/types';
import { ELEMENT_TYPES } from '../../src/core/model/types';
import { sha256OfBase64 } from '../../src/core/format/sha256';

const PLACEHOLDER_ASSET_ID = 'asset-0';
const PLACEHOLDER_ENDPOINT = 'endpoint';

/** Number with at most 2 decimals inside [min, max]. */
function decimal2(min: number, max: number): fc.Arbitrary<number> {
  return fc.integer({ min: Math.ceil(min * 100), max: Math.floor(max * 100) }).map((n) => n / 100);
}

const arbCoord = decimal2(COORD_RANGE.min, COORD_RANGE.max);
/** Keep sizes moderate so x + width stays inside the coordinate range. */
const arbSize = decimal2(MIN_SIZE, 10_000);

export const arbBounds: fc.Arbitrary<Bounds> = fc.record({
  x: arbCoord,
  y: arbCoord,
  width: arbSize,
  height: arbSize,
});

export const arbViewport: fc.Arbitrary<Viewport> = fc.record({
  x: arbCoord,
  y: arbCoord,
  zoom: fc.double({ min: ZOOM_RANGE.min, max: ZOOM_RANGE.max, noNaN: true }),
});

const arbColor: fc.Arbitrary<Color> = fc.oneof(
  fc.constant<Color>('theme:default'),
  fc
    .integer({ min: 0, max: 0xffffff })
    .map((n): Color => `#${n.toString(16).padStart(6, '0')}`),
);

function arbStyle(width: number, height: number): fc.Arbitrary<ElementStyle> {
  const maxRadius = Math.min(width, height) / 2;
  return fc.record({
    fill: arbColor,
    stroke: arbColor,
    strokeWidth: decimal2(STROKE_WIDTH_RANGE.min, STROKE_WIDTH_RANGE.max),
    strokeStyle: fc.constantFrom('solid', 'dashed', 'dotted'),
    opacity: fc.integer({ min: OPACITY_RANGE.min, max: OPACITY_RANGE.max }),
    cornerRadius: fc.integer({ min: 0, max: 100 }).map((p) => Math.floor(((maxRadius * p) / 100) * 100) / 100),
  });
}

const arbText = fc.string({ maxLength: 40 });

const arbRun: fc.Arbitrary<TextRun> = fc.record(
  { text: arbText, bold: fc.boolean(), italic: fc.boolean(), underline: fc.boolean() },
  { requiredKeys: ['text'] },
);

const arbTextProps: fc.Arbitrary<TextProps> = fc.record({
  runs: fc.array(arbRun, { minLength: 1, maxLength: 3 }),
  fontFamily: fc.constantFrom('sans-serif', 'serif', 'monospace'),
  fontSize: fc.integer({ min: FONT_SIZE_RANGE.min, max: FONT_SIZE_RANGE.max }),
  align: fc.constantFrom('left', 'center', 'right'),
});

const arbFreehandPoint: fc.Arbitrary<FreehandPoint> = fc.record(
  { x: arbCoord, y: arbCoord, p: fc.double({ min: 0, max: 1, noNaN: true }) },
  { requiredKeys: ['x', 'y'] },
);

const arbArrowHead: fc.Arbitrary<ArrowHead> = fc.constantFrom('none', 'arrow', 'triangle', 'circle', 'diamond', 'bar');
const arbRouting: fc.Arbitrary<EdgeRouting> = fc.constantFrom('straight', 'curved', 'orthogonal');
const arbPreset: fc.Arbitrary<FlowNodePreset> = fc.constantFrom(
  'startEnd',
  'process',
  'decision',
  'inputOutput',
  'database',
  'document',
  'annotation',
);

/**
 * Element of the given type with a placeholder id. Edge endpoints and image asset
 * ids are placeholders; `arbBoardDocument` rewires them to real targets.
 */
export function arbElement(type: ElementType, id = 'el-0'): fc.Arbitrary<Element> {
  const base = arbBounds.chain((b) =>
    fc.record(
      {
        rotation: decimal2(ROTATION_RANGE.min, ROTATION_RANGE.max),
        locked: fc.boolean(),
        groupId: fc.constantFrom('g1', 'g2', 'g3'),
        style: arbStyle(b.width, b.height),
      },
      { requiredKeys: ['rotation', 'style'] },
    ).map(
      (r): ElementBase => ({ id, type, ...b, ...r }),
    ),
  );

  switch (type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'line':
    case 'arrow':
      return base as fc.Arbitrary<Element>;
    case 'freehand':
      return fc
        .tuple(
          base,
          fc.array(arbFreehandPoint, { minLength: 1, maxLength: 20 }),
          fc.integer({ min: FREEHAND_BASE_WIDTH_RANGE.min, max: FREEHAND_BASE_WIDTH_RANGE.max }),
        )
        .map(([b, points, baseWidth]) => ({ ...b, type: 'freehand', points, baseWidth }) as Element);
    case 'text':
    case 'sticky':
      return fc.tuple(base, arbTextProps).map(([b, t]) => ({ ...b, ...t, type }) as Element);
    case 'flowNode':
      return fc
        .tuple(base, arbTextProps, arbPreset)
        .map(([b, t, preset]) => ({ ...b, ...t, preset, type: 'flowNode' }) as Element);
    case 'image':
      return fc
        .tuple(
          base,
          fc.record(
            {
              crop: fc.record({ x: arbSize, y: arbSize, w: arbSize, h: arbSize }),
              alt: fc.string({ maxLength: ALT_TEXT_MAX }),
            },
            { requiredKeys: [] },
          ),
        )
        .map(([b, p]) => ({ ...b, ...p, type: 'image', assetId: PLACEHOLDER_ASSET_ID }) as Element);
    case 'frame':
      return fc
        .tuple(base, fc.string({ maxLength: 30 }))
        .map(([b, name]) => ({ ...b, type: 'frame', name }) as Element);
    case 'icon':
      return fc
        .tuple(base, fc.string({ minLength: 1, maxLength: 64 }))
        .map(([b, name]) => ({ ...b, type: 'icon', name }) as Element);
    case 'edge':
      return fc
        .tuple(base, arbRouting, arbArrowHead, arbArrowHead, fc.option(fc.string({ maxLength: EDGE_LABEL_MAX }), { nil: undefined }))
        .map(([b, routing, sourceArrow, targetArrow, label]) => {
          const e = { ...b, type: 'edge', sourceId: PLACEHOLDER_ENDPOINT, targetId: PLACEHOLDER_ENDPOINT, routing, sourceArrow, targetArrow } as Element;
          if (label !== undefined) (e as { label?: string }).label = label;
          return e;
        });
  }
}

const arbAnyElementType = fc.constantFrom(...ELEMENT_TYPES);

const arbAsset: fc.Arbitrary<Asset> = fc.record({
  id: fc.constant('asset-0'),
  mime: fc.constantFrom<AssetMime>('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'),
  hash: fc.stringMatching(/^[0-9a-f]{64}$/),
  width: fc.integer({ min: 1, max: 4096 }),
  height: fc.integer({ min: 1, max: 4096 }),
  data: fc.base64String({ maxLength: 40 }),
});

/** Raw element plus random seeds used to wire parent / endpoint / asset references. */
const arbRawElement = fc.tuple(
  arbAnyElementType.chain((t) => arbElement(t)),
  fc.nat(),
  fc.nat(),
  fc.nat(),
  fc.boolean(),
);

/** Valid BoardDocument with 0..maxElements (default 500) elements. */
export function arbBoardDocument(maxElements = 500): fc.Arbitrary<BoardDocument> {
  return fc
    .tuple(
      fc.array(arbRawElement, { maxLength: maxElements }),
      fc.array(arbAsset, { maxLength: 3 }),
      arbViewport,
      fc.stringMatching(/^[a-z0-9-]{1,20}$/),
    )
    .map(([raw, assetSeeds, viewport, boardId]): BoardDocument => {
      // Unique payloads with consistent hashes, so serialization's dedup / hash recompute is a no-op.
      const seenData = new Set<string>();
      const allAssets: Asset[] = assetSeeds
        .filter((a) => !seenData.has(a.data) && seenData.add(a.data))
        .map((a, i) => ({ ...a, id: `asset-${i}`, hash: sha256OfBase64(a.data) ?? a.hash }));
      const assets = allAssets;
      const withIds = raw
        .map(([el, s1, s2, s3, useParent], i) => ({
          el: { ...el, id: `el-${i}` } as Element,
          s1,
          s2,
          s3,
          useParent,
        }))
        // Images need an asset; drop them up front so edge endpoints never point at a dropped element.
        .filter((r) => r.el.type !== 'image' || assets.length > 0);
      const frames = withIds.filter((r) => r.el.type === 'frame').map((r) => r.el.id);
      const endpoints = withIds.filter((r) => r.el.type !== 'edge').map((r) => r.el.id);
      const elements: Element[] = [];
      for (const { el, s1, s2, s3, useParent } of withIds) {
        if (el.type === 'image') {
          if (assets.length === 0) continue;
          el.assetId = assets[s1 % assets.length]!.id;
        } else if (el.type === 'edge') {
          if (endpoints.length === 0) continue;
          el.sourceId = endpoints[s1 % endpoints.length]!;
          el.targetId = endpoints[s2 % endpoints.length]!;
        }
        if (el.type !== 'edge' && el.type !== 'frame' && useParent && frames.length > 0) {
          el.parentId = frames[s3 % frames.length]!;
        }
        elements.push(el);
      }
      // The serializer drops unreferenced assets, so only keep referenced ones.
      const used = new Set(elements.filter((e): e is Extract<Element, { type: 'image' }> => e.type === 'image').map((e) => e.assetId));
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        meta: { id: boardId },
        viewport,
        elements,
        assets: assets.filter((a) => used.has(a.id)),
        library: [],
      };
    });
}

// ---------------------------------------------------------------------------
// Edit sequences
// ---------------------------------------------------------------------------

/** Abstract edit operations; `target` is an index resolved modulo the element count at apply time. */
export type EditOp =
  | { kind: 'move'; target: number; dx: number; dy: number }
  | { kind: 'resize'; target: number; width: number; height: number }
  | { kind: 'rotate'; target: number; rotation: number }
  | { kind: 'setOpacity'; target: number; opacity: number }
  | { kind: 'toggleLock'; target: number }
  | { kind: 'delete'; target: number }
  | { kind: 'reorder'; target: number; mode: 'front' | 'back' | 'forward' | 'backward' }
  | { kind: 'add'; element: Element };

const arbEditOp: fc.Arbitrary<EditOp> = fc.oneof(
  fc.record({ kind: fc.constant('move' as const), target: fc.nat(), dx: decimal2(-1000, 1000), dy: decimal2(-1000, 1000) }),
  fc.record({ kind: fc.constant('resize' as const), target: fc.nat(), width: arbSize, height: arbSize }),
  fc.record({ kind: fc.constant('rotate' as const), target: fc.nat(), rotation: decimal2(ROTATION_RANGE.min, ROTATION_RANGE.max) }),
  fc.record({
    kind: fc.constant('setOpacity' as const),
    target: fc.nat(),
    opacity: fc.integer({ min: OPACITY_RANGE.min, max: OPACITY_RANGE.max }),
  }),
  fc.record({ kind: fc.constant('toggleLock' as const), target: fc.nat() }),
  fc.record({ kind: fc.constant('delete' as const), target: fc.nat() }),
  fc.record({
    kind: fc.constant('reorder' as const),
    target: fc.nat(),
    mode: fc.constantFrom('front' as const, 'back' as const, 'forward' as const, 'backward' as const),
  }),
  fc
    .constantFrom<ElementType>('rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freehand', 'text', 'sticky', 'frame')
    .chain((t) => arbElement(t))
    .map((element): EditOp => ({ kind: 'add', element })),
);

export function arbEditSequence(maxLength = 30): fc.Arbitrary<EditOp[]> {
  return fc.array(arbEditOp, { maxLength });
}

// ---------------------------------------------------------------------------
// Mockup design features (Req 28.1, 28.3): tokens, components, layout, nesting, v1/v2 documents.
// Documented in ./mockup.ts. Re-exported last because mockup.ts imports arbElement/arbBoardDocument.
// ---------------------------------------------------------------------------
export * from './mockup';
