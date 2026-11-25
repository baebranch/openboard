import type { Asset, BoardDocument, Element, LibraryComponent } from '../model/types';
import { sha256OfBase64 } from './sha256';
import { effectiveSchemaVersion } from './schema-version';

/** Canonical JSON: sorted keys at every level, 2-space indent, `\n` endings, trailing newline. */
export function canonicalStringify(value: unknown): string {
  return write(value, '') + '\n';
}

function write(value: unknown, indent: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      return 'null';
  }
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => inner + (v === undefined ? 'null' : write(v, inner)));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
    .sort();
  if (keys.length === 0) return '{}';
  const items = keys.map((k) => inner + JSON.stringify(k) + ': ' + write(obj[k], inner));
  return '{\n' + items.join(',\n') + '\n' + indent + '}';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively flattens `extra` bags back into their parent object. Known properties win over
 * colliding extra keys. The contents of an extra bag are opaque and emitted as-is.
 */
function flatten(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(flatten);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  const extra = value['extra'];
  if (isPlainObject(extra)) {
    for (const k of Object.keys(extra)) out[k] = extra[k];
  }
  for (const k of Object.keys(value)) {
    if (k === 'extra' && isPlainObject(extra)) continue;
    out[k] = flatten(value[k]);
  }
  return out;
}

function assetHash(a: Asset): string {
  return sha256OfBase64(a.data) ?? a.hash;
}

function mapElementAssets(els: Element[], remap: Map<string, string>, used: Set<string>): Element[] {
  return els.map((el) => {
    let out: Element = el;
    const fill = el.style?.imageFill;
    if (fill) {
      const fid = remap.get(fill.assetId) ?? fill.assetId;
      used.add(fid);
      if (fid !== fill.assetId) out = { ...el, style: { ...el.style, imageFill: { ...fill, assetId: fid } } } as Element;
    }
    if (out.type !== 'image') return out;
    const id = remap.get(out.assetId) ?? out.assetId;
    used.add(id);
    return id === out.assetId ? out : { ...out, assetId: id };
  });
}

/**
 * Returns assets deduplicated by SHA-256 of their bytes (first occurrence wins), with image
 * references rewritten to the surviving asset, and unreferenced assets dropped.
 */
function normalizeAssets(doc: BoardDocument): {
  assets: Asset[];
  elements: Element[];
  library: LibraryComponent[];
} {
  const byHash = new Map<string, Asset>();
  const remap = new Map<string, string>();
  for (const a of doc.assets) {
    const hash = assetHash(a);
    const existing = byHash.get(hash);
    if (existing) {
      if (!remap.has(a.id) && existing.id !== a.id) remap.set(a.id, existing.id);
    } else {
      byHash.set(hash, { ...a, hash });
    }
  }
  const used = new Set<string>();
  const elements = mapElementAssets(doc.elements, remap, used);
  const library = doc.library.map((c) => ({ ...c, elements: mapElementAssets(c.elements, remap, used) }));
  const assets = [...byHash.values()].filter((a) => used.has(a.id));
  return { assets, elements, library };
}

/** Serializes a Board_Document to canonical UTF-8 JSON text. */
export function serialize(doc: BoardDocument): string {
  const { assets, elements, library } = normalizeAssets(doc);
  return canonicalStringify(flatten({ ...doc, schemaVersion: effectiveSchemaVersion(doc), assets, elements, library }));
}
