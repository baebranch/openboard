import { intersects, rotatedBounds, unionBounds } from '../model/geometry';
import type { BoardDocument, Bounds, Element, ElementId } from '../model/types';

export const EXPORT_MAX_PIXELS = 16384;
export const EXPORT_PADDING_MIN = 0;
export const EXPORT_PADDING_MAX = 256;

export const EXPORT_FORMATS = ['png', 'svg', 'jpeg', 'webp', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_SCALES = [1, 2, 3, 4] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];
export type ExportBackground = 'transparent' | 'white' | 'theme';

export type ExportScope =
  | { kind: 'board' }
  | { kind: 'selection'; ids: ElementId[] }
  | { kind: 'frame'; id: ElementId }
  | { kind: 'allFrames' };

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  scale: ExportScale;
  /** Integer 0..256. */
  padding: number;
  background: ExportBackground;
  matchTheme: boolean;
  /** Token mode to export in (Req 12.5): `light`, `dark`, or `active` (the board's mode, the default). */
  tokenMode?: 'light' | 'dark' | 'active';
  /** PNG only. */
  embedBoard?: boolean;
  /** Omit Component_Masters, their descendants, and attached connectors (Req 17.2). Default false. */
  excludeMasters?: boolean;
}

export type ExportErrorCode = 'empty-scope' | 'size-limit' | 'invalid-padding' | 'invalid-option';

export interface ExportError {
  code: ExportErrorCode;
  message: string;
}

export type ExportResult<T> = { ok: true; value: T } | { ok: false; error: ExportError };

export const PADDING_RANGE_MESSAGE = `Padding must be a whole number from ${EXPORT_PADDING_MIN} to ${EXPORT_PADDING_MAX}.`;
export const EMPTY_SCOPE_MESSAGE = 'There is nothing to export.';
export const SIZE_LIMIT_MESSAGE = `The export exceeds the ${EXPORT_MAX_PIXELS.toLocaleString('en-US')} pixel limit on width or height.`;

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'png',
  scope: { kind: 'board' },
  scale: 1,
  padding: 0,
  background: 'white',
  matchTheme: false,
};

function elementBounds(el: Element): Bounds {
  return rotatedBounds(el);
}

/** Elements of the document that fall inside the scope region (Req 12.2, 12.15). */
export function selectScope(doc: Pick<BoardDocument, 'elements'>, scope: ExportScope): Element[] {
  const all = doc.elements;
  switch (scope.kind) {
    case 'board':
      return [...all];
    case 'selection': {
      const ids = new Set(scope.ids);
      return all.filter((e) => ids.has(e.id));
    }
    case 'frame': {
      const frame = all.find((e) => e.id === scope.id && e.type === 'frame');
      return frame ? inFrame(all, frame) : [];
    }
    case 'allFrames': {
      const frames = topLevelFrames(all);
      return all.filter((e) => frames.some((f) => e.id === f.id || belongsToFrame(e, f, all)));
    }
  }
}

/** Frames with no Frame parent; the all-Frames scope yields one file per such Frame (Req 21.9). */
export function topLevelFrames(elements: readonly Element[]): Element[] {
  const frameIds = new Set(elements.filter((e) => e.type === 'frame').map((e) => e.id));
  return elements.filter((e) => e.type === 'frame' && !(e.parentId !== undefined && frameIds.has(e.parentId)));
}

/** Elements for one Frame (top-level or nested): the frame, its descendants, and anything intersecting its bounds. */
export function inFrame(elements: readonly Element[], frame: Element): Element[] {
  return elements.filter((e) => e.id === frame.id || belongsToFrame(e, frame, elements));
}

const byIdCache = new WeakMap<readonly Element[], Map<ElementId, Element>>();

function belongsToFrame(e: Element, frame: Element, all: readonly Element[]): boolean {
  if (e.parentId === frame.id || intersects(elementBounds(e), elementBounds(frame))) return true;
  if (e.parentId === undefined) return false;
  // Deeper descendants: walk the parent chain (cycle-safe).
  let byId = byIdCache.get(all);
  if (!byId) {
    byId = new Map(all.map((x) => [x.id, x]));
    byIdCache.set(all, byId);
  }
  const seen = new Set<ElementId>();
  for (let cur = byId.get(e.parentId); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.id === frame.id) return true;
    seen.add(cur.id);
  }
  return false;
}

/** Whether the document has at least one Component_Master (Req 17.1). */
export function hasComponentMasters(doc: Pick<BoardDocument, 'elements'>): boolean {
  return doc.elements.some((e) => e.type === 'frame' && e.component !== undefined);
}

/**
 * Drops every Component_Master, every descendant of one, and every Edge with an endpoint among
 * the dropped Elements (Req 17.2). Returns a doc whose other elements are unchanged.
 */
export function omitComponentMasters<D extends Pick<BoardDocument, 'elements'>>(doc: D): D {
  if (!hasComponentMasters(doc)) return doc;
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const omitted = new Set<ElementId>();
  const isOmitted = (e: Element): boolean => {
    const seen = new Set<ElementId>();
    for (let cur: Element | undefined = e; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (omitted.has(cur.id)) return true;
      if (cur.type === 'frame' && cur.component !== undefined) return true;
      seen.add(cur.id);
    }
    return false;
  };
  for (const e of doc.elements) if (isOmitted(e)) omitted.add(e.id);
  const elements = doc.elements.filter(
    (e) => !omitted.has(e.id) && !(e.type === 'edge' && (omitted.has(e.sourceId) || omitted.has(e.targetId))),
  );
  return { ...doc, elements };
}

/** Per-Frame element lists for the all-Frames scope (one file per Frame). */
export function selectFrameScopes(
  doc: Pick<BoardDocument, 'elements'>,
  options: { excludeMasters?: boolean } = {},
): { frame: Element; elements: Element[] }[] {
  if (options.excludeMasters) doc = omitComponentMasters(doc);
  return topLevelFrames(doc.elements).map((frame) => ({ frame, elements: inFrame(doc.elements, frame) }));
}

/** Union of the elements' (rotated) bounds, or undefined when empty. */
export function contentBounds(elements: readonly Element[]): Bounds | undefined {
  return unionBounds(elements.map(elementBounds));
}

export function validatePadding(x: unknown): x is number {
  return (
    typeof x === 'number' && Number.isInteger(x) && x >= EXPORT_PADDING_MIN && x <= EXPORT_PADDING_MAX
  );
}

/** Returns the candidate when valid, otherwise the previous valid value (Req 12.6). */
export function resolvePadding(candidate: unknown, previous: number): { value: number; error?: ExportError } {
  if (validatePadding(candidate)) return { value: candidate };
  return { value: previous, error: { code: 'invalid-padding', message: PADDING_RANGE_MESSAGE } };
}

/** Output pixel size: (bounds + padding on all sides) * scale, rounded up to whole pixels. */
export function computeOutputSize(
  bounds: Pick<Bounds, 'width' | 'height'>,
  padding: number,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.ceil((bounds.width + 2 * padding) * scale),
    h: Math.ceil((bounds.height + 2 * padding) * scale),
  };
}

/** Validates scope emptiness and the pixel limit; returns the output size on success. */
export function checkLimits(
  elements: readonly Element[],
  padding: number,
  scale: number,
  /** Output region overriding the content bounds (a Frame's own box). */
  region?: Bounds,
): ExportResult<{ w: number; h: number; bounds: Bounds }> {
  const content = contentBounds(elements);
  const bounds = content && region && region.width > 0 && region.height > 0 ? region : content;
  if (!bounds) return { ok: false, error: { code: 'empty-scope', message: EMPTY_SCOPE_MESSAGE } };
  const size = computeOutputSize(bounds, padding, scale);
  if (size.w > EXPORT_MAX_PIXELS || size.h > EXPORT_MAX_PIXELS) {
    return { ok: false, error: { code: 'size-limit', message: SIZE_LIMIT_MESSAGE } };
  }
  return { ok: true, value: { ...size, bounds } };
}

/** Validates format, scale, padding and background combinations (Req 12.3 to 12.6). */
export function validateOptions(opts: ExportOptions): ExportError | undefined {
  if (!(EXPORT_FORMATS as readonly string[]).includes(opts.format)) {
    return { code: 'invalid-option', message: `Unsupported format: ${String(opts.format)}.` };
  }
  if (!(EXPORT_SCALES as readonly number[]).includes(opts.scale)) {
    return { code: 'invalid-option', message: 'Scale must be 1, 2, 3, or 4.' };
  }
  if (!validatePadding(opts.padding)) return { code: 'invalid-padding', message: PADDING_RANGE_MESSAGE };
  if (opts.background === 'transparent' && opts.format !== 'png' && opts.format !== 'webp') {
    return { code: 'invalid-option', message: 'Transparent background is only available for PNG and WebP.' };
  }
  if (opts.embedBoard && opts.format !== 'png') {
    return { code: 'invalid-option', message: 'Embedding the board is only available for PNG.' };
  }
  return undefined;
}

/** Whether the format is a raster format subject to scale and the pixel limit. */
export function isRaster(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpeg' || format === 'webp';
}

/** Full pre-flight check for one export region. */
export function prepareExport(
  doc: Pick<BoardDocument, 'elements'>,
  opts: ExportOptions,
): ExportResult<{ elements: Element[]; bounds: Bounds; w: number; h: number; cropped?: boolean }> {
  const err = validateOptions(opts);
  if (err) return { ok: false, error: err };
  const elements = selectScope(opts.excludeMasters ? omitComponentMasters(doc) : doc, opts.scope);
  const scale = isRaster(opts.format) ? opts.scale : 1;
  // A Frame exports cut to its own box, so content hanging past its edge adds no blank space.
  const scope = opts.scope;
  const frame = scope.kind === 'frame' ? elements.find((e) => e.id === scope.id && e.type === 'frame') : undefined;
  const region = frame ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height } : undefined;
  const r = checkLimits(elements, opts.padding, scale, region);
  if (!r.ok) return r;
  return { ok: true, value: { elements, ...r.value, ...(region ? { cropped: true } : {}) } };
}
