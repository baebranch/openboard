/**
 * `openboard.import` (Req 8.11, 13.2). Imports Mermaid text, an image, a library component, or a
 * PNG with an embedded board. Handlers are synchronous and mutate only through the given `tx`.
 */
import { planComponentClone, remapComponentFields } from '../components/remap';
import { extractDocument } from '../export/png-chunk';
import { base64Decode, parse, sha256Hex } from '../format';
import { replaceImageSource, sizeForNaturalDimensions, validateImageFile, type ImageMime } from '../image';
import { autoLayout } from '../layout';
import { findComponent } from '../library/builtins';
import { isMermaidError, parseMermaid, type MermaidNode } from '../mermaid';
import { fieldsFor, newId, type Element, type FlowNodePreset } from '../model';
import type { ElementInput, Tx } from '../ops';
import { s } from '../schema/builder';
import { defaultStyle, frameNestingProblem } from '../shapes';
import type { DefaultToolRegistry, ToolDefinition } from './registry';

class ImportFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const IMPORT_SOURCES = ['mermaid', 'image', 'component', 'png'] as const;
type ImportSource = (typeof IMPORT_SOURCES)[number];

interface ImportInput {
  board?: string;
  source: ImportSource;
  /** mermaid: flowchart text. */
  text?: string;
  /** image / png: base64 payload (a `data:` URI prefix is accepted). */
  data?: string;
  /** image: natural size when the caller knows it. */
  width?: number;
  height?: number;
  alt?: string;
  /** image: id of an existing image element whose source is replaced instead of creating a new element. */
  replace?: string;
  /** image: ids of existing elements that get the image as `style.imageFill` (fit `cover`) instead of a new image element. */
  fillIds?: string[];
  /** component: library id or name. */
  component?: string;
  /** Top-left of the imported content (optional for component / png / image). */
  x?: number;
  y?: number;
}

interface ImportOutput {
  ids: string[];
  assetId?: string;
  error?: { code: string; message: string; line?: number };
}

// --- image dimension sniffing (header only) ----------------------------------------------------

const u16be = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u16le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, o: number): number => u16le(b, o) | ((b[o + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, o: number): number => (u16be(b, o) * 65536 + u16be(b, o + 2)) >>> 0;

/** Natural dimensions from the file header, or undefined when they cannot be determined. */
export function readImageDimensions(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | undefined {
  switch (mime) {
    case 'image/png':
      return bytes.length >= 24 ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : undefined;
    case 'image/gif':
      return bytes.length >= 10 ? { width: u16le(bytes, 6), height: u16le(bytes, 8) } : undefined;
    case 'image/jpeg': {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1] ?? 0;
        if (marker === 0xff) {
          i++;
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) };
        i += 2 + u16be(bytes, i + 2);
      }
      return undefined;
    }
    case 'image/webp': {
      const tag = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
      if (tag === 'VP8X' && bytes.length >= 30) return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
      if (tag === 'VP8L' && bytes.length >= 25) {
        const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (tag === 'VP8 ' && bytes.length >= 30) return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
      return undefined;
    }
    case 'image/svg+xml': {
      const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
      const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
      const attr = (name: string): number | undefined => {
        const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`, 'i').exec(tag);
        return m ? Number(m[1]) : undefined;
      };
      const w = attr('width');
      const h = attr('height');
      if (w && h) return { width: w, height: h };
      const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
      return undefined;
    }
  }
}

// --- helpers -----------------------------------------------------------------------------------

function decodeBase64(data: string | undefined, what: string): Uint8Array {
  if (data === undefined || data === '') throw new ImportFailure('invalid_input', `"data" (base64 ${what}) is required`);
  const stripped = data.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  const bytes = base64Decode(stripped);
  if (!bytes) throw new ImportFailure('invalid_data', `"data" is not valid base64`);
  return bytes;
}

function nodeSize(preset: FlowNodePreset): { width: number; height: number } {
  return preset === 'decision' ? { width: 160, height: 80 } : { width: 160, height: 60 };
}

// --- mermaid -----------------------------------------------------------------------------------

function importMermaid(tx: Tx, input: ImportInput): ImportOutput {
  if (input.text === undefined) throw new ImportFailure('invalid_input', '"text" is required for source "mermaid"');
  const parsed = parseMermaid(input.text);
  if (isMermaidError(parsed)) {
    return { ids: [], error: { code: 'parse_error', message: parsed.error.message, line: parsed.error.line } };
  }
  const ox = input.x ?? 0;
  const oy = input.y ?? 0;
  const idOf = new Map<string, string>();
  const created: Array<{ id: string; node: MermaidNode }> = [];
  for (const node of parsed.nodes) {
    const size = nodeSize(node.preset);
    const el = tx.create({
      type: 'flowNode',
      x: ox,
      y: oy,
      ...size,
      rotation: 0,
      style: defaultStyle(),
      runs: [{ text: node.label }],
      fontFamily: 'sans-serif',
      fontSize: 16,
      align: 'center',
      preset: node.preset,
    } as ElementInput);
    idOf.set(node.id, el.id);
    created.push({ id: el.id, node });
  }
  const edgeIds: string[] = [];
  for (const link of parsed.links) {
    const el = tx.create({
      type: 'edge',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      style: { ...defaultStyle(), strokeStyle: link.style === 'dotted' ? 'dotted' : 'solid' },
      sourceId: idOf.get(link.source)!,
      targetId: idOf.get(link.target)!,
      routing: 'straight',
      sourceArrow: 'none',
      targetArrow: link.arrow ? 'arrow' : 'none',
      ...(link.label !== undefined ? { label: link.label } : {}),
    } as ElementInput);
    edgeIds.push(el.id);
  }
  if (created.length >= 2) {
    const result = autoLayout(
      created.map(({ id, node }) => ({ id, x: ox, y: oy, ...nodeSize(node.preset) })),
      parsed.links.map((l) => ({ sourceId: idOf.get(l.source)!, targetId: idOf.get(l.target)! })),
      parsed.direction,
    );
    if (result.ok) for (const [id, p] of result.value) tx.update(id, { x: p.x, y: p.y });
  }
  return { ids: [...created.map((c) => c.id), ...edgeIds] };
}

// --- image -------------------------------------------------------------------------------------

function importImage(tx: Tx, input: ImportInput): ImportOutput {
  const bytes = decodeBase64(input.data, 'image');
  const valid = validateImageFile(bytes);
  if (!valid.ok) throw new ImportFailure(valid.reason === 'too-large' ? 'image_too_large' : 'invalid_image', valid.message);
  let natural = input.width !== undefined && input.height !== undefined ? { width: input.width, height: input.height } : undefined;
  natural ??= readImageDimensions(bytes, valid.mime);
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
    throw new ImportFailure('invalid_image', 'Could not determine the image size; pass "width" and "height".');
  }
  const assetId = tx.addAsset({
    mime: valid.mime,
    hash: sha256Hex(bytes),
    width: natural.width,
    height: natural.height,
    data: input.data!.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, ''),
  });
  if (input.replace !== undefined) {
    // Replace-source (Req 7.8): keep position, rotation and width; height follows the new aspect ratio.
    const target = tx.doc.elements.find((e) => e.id === input.replace);
    if (!target || target.type !== 'image') throw new ImportFailure('not_found', `Image element not found: ${input.replace}`);
    const next = replaceImageSource(target, natural);
    tx.update(target.id, { assetId, height: next.height } as never);
    return { ids: [target.id], assetId };
  }
  if (input.fillIds !== undefined) {
    // Image fill (Req 9.6): validate every target first so a bad id changes nothing beyond the (unreferenced) asset.
    const targets = input.fillIds.map((id) => {
      const el = tx.doc.elements.find((e) => e.id === id);
      if (!el) throw new ImportFailure('not_found', `Element not found: ${id}`);
      if (!fieldsFor('style', el.type).includes('imageFill')) {
        throw new ImportFailure('invalid_property', `Element ${id} (${el.type}) does not support imageFill`);
      }
      return el;
    });
    for (const el of targets) tx.update(el.id, { style: { imageFill: { assetId, fit: 'cover' } } } as never);
    return { ids: targets.map((e) => e.id), assetId };
  }
  const size = sizeForNaturalDimensions(natural.width, natural.height);
  const el = tx.create({
    type: 'image',
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: size.width,
    height: size.height,
    rotation: 0,
    style: defaultStyle(),
    assetId,
    ...(input.alt !== undefined ? { alt: input.alt } : {}),
  } as ElementInput);
  return { ids: [el.id], assetId };
}

// --- cloning elements with fresh ids (component / png) ----------------------------------------

export function cloneElements(
  tx: Tx,
  source: readonly Element[],
  at: { x?: number; y?: number },
  assetMap?: Map<string, string>,
  opts?: { keepIds?: boolean },
): string[] {
  if (source.length === 0) return [];
  const plan = planComponentClone(source, tx.doc.elements);
  const idMap = new Map(source.filter((e) => !plan.skip.has(e.id)).map((e) => [e.id, opts?.keepIds ? e.id : newId()]));
  const movable = source.filter((e) => e.type !== 'edge');
  const basis = movable.length > 0 ? movable : source;
  const dx = at.x !== undefined ? at.x - Math.min(...basis.map((e) => e.x)) : 0;
  const dy = at.y !== undefined ? at.y - Math.min(...basis.map((e) => e.y)) : 0;
  const ids: string[] = [];
  // Parents (frames) first so children can reference them; z-order is kept otherwise.
  for (const e of source) {
    if (plan.skip.has(e.id)) continue; // regenerated by the Sync_Pass with derived ids
    const copy = structuredClone(e) as unknown as Record<string, unknown>;
    remapComponentFields(copy, e, plan, idMap);
    copy['id'] = idMap.get(e.id);
    copy['x'] = e.x + dx;
    copy['y'] = e.y + dy;
    if (typeof copy['parentId'] === 'string') {
      const p = idMap.get(copy['parentId']);
      if (p) copy['parentId'] = p;
      else delete copy['parentId'];
    }
    if (e.type === 'edge') {
      const src = idMap.get(e.sourceId);
      const dst = idMap.get(e.targetId);
      if (!src || !dst) continue; // dangling edge: skip rather than create an invalid reference
      copy['sourceId'] = src;
      copy['targetId'] = dst;
    }
    if (e.type === 'image' && assetMap) {
      const a = assetMap.get(e.assetId);
      if (!a) continue;
      copy['assetId'] = a;
    }
    tx.create(copy as unknown as ElementInput);
    ids.push(copy['id'] as string);
  }
  const problem = frameNestingProblem(tx.doc.elements, ids);
  if (problem !== undefined) throw new ImportFailure('invalid_parent', problem);
  return ids;
}

function importComponent(tx: Tx, input: ImportInput): ImportOutput {
  if (!input.component) throw new ImportFailure('invalid_input', '"component" (id or name) is required for source "component"');
  const lookup = findComponent(tx.doc.library, input.component);
  if (!lookup.component) throw new ImportFailure(lookup.error!.code, lookup.error!.message);
  const comp = lookup.component;
  return { ids: cloneElements(tx, comp.elements, input) };
}

function importPng(tx: Tx, input: ImportInput): ImportOutput {
  const bytes = decodeBase64(input.data, 'PNG');
  let json: string | undefined;
  try {
    json = extractDocument(bytes);
  } catch (e) {
    throw new ImportFailure('invalid_image', e instanceof Error ? e.message : 'Not a valid PNG');
  }
  if (json === undefined) throw new ImportFailure('no_embedded_board', 'The PNG does not contain an embedded board.');
  const parsed = parse(json);
  if (!parsed.ok) throw new ImportFailure('invalid_board', `The embedded board is invalid: ${parsed.message}`);
  const doc = parsed.doc;
  const assetMap = new Map<string, string>();
  for (const a of doc.assets) {
    const { id: _id, ...rest } = a;
    void _id;
    assetMap.set(a.id, tx.addAsset(rest));
  }
  return { ids: cloneElements(tx, doc.elements, input, assetMap) };
}

// --- tool --------------------------------------------------------------------------------------

const importTool: ToolDefinition<ImportInput, ImportOutput> = {
  name: 'openboard.import',
  description:
    'Import content into a board. `source` is "mermaid" (flowchart `text`, laid out automatically; a syntax error returns `error` with the line and creates nothing), "image" (base64 `data`; optional `width`/`height`, `alt`, `x`, `y`; `replace` swaps an image element\'s source; `fillIds` sets the image as `style.imageFill` with fit "cover" on those elements instead of creating an image), "component" (library id or name in `component`, inserted with new ids), or "png" (base64 `data` of a PNG exported with an embedded board).',
  inputSchema: s.object({
    board: s.opt(s.string({ minLength: 1 })),
    source: s.enum(IMPORT_SOURCES),
    text: s.opt(s.string()),
    data: s.opt(s.string()),
    width: s.opt(s.number({ min: 1 })),
    height: s.opt(s.number({ min: 1 })),
    alt: s.opt(s.string({ maxLength: 500 })),
    replace: s.opt(s.string({ minLength: 1 })),
    fillIds: s.opt(s.array(s.string({ minLength: 1 }), { minItems: 1 })),
    component: s.opt(s.string({ minLength: 1 })),
    x: s.opt(s.number()),
    y: s.opt(s.number()),
  }),
  outputSchema: s.object({
    ids: s.array(s.string()),
    assetId: s.opt(s.string()),
    error: s.opt(
      s.object({ code: s.string(), message: s.string(), line: s.opt(s.integer({ min: 1 })) }),
    ),
  }),
  readOnly: false,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = ctx.tx;
    if (!tx) throw new ImportFailure('no_board', 'No board is available for this tool');
    switch (input.source) {
      case 'mermaid':
        return importMermaid(tx, input);
      case 'image':
        return importImage(tx, input);
      case 'component':
        return importComponent(tx, input);
      case 'png':
        return importPng(tx, input);
    }
  },
};

export const importTools: ToolDefinition[] = [importTool];

export function registerImportTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of importTools) registry.register(t);
}
