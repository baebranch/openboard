import type { BoardDocument } from '../model/types';
import { MAX_TOKENS_PER_CATEGORY, TOKEN_CATEGORIES } from '../tokens/types';
import { validateTokenName, validateTokenValue } from '../tokens/validate';

/** Returns a list of violated-invariant messages (empty when the document is consistent). */
export function checkInvariants(doc: BoardDocument): string[] {
  const problems: string[] = [];
  const byId = new Map<string, BoardDocument['elements'][number]>();
  for (const el of doc.elements) {
    if (byId.has(el.id)) problems.push(`Duplicate element id: ${el.id}`);
    byId.set(el.id, el);
  }
  const assetIds = new Set<string>();
  for (const a of doc.assets) {
    if (assetIds.has(a.id)) problems.push(`Duplicate asset id: ${a.id}`);
    assetIds.add(a.id);
  }
  for (const el of doc.elements) {
    if (el.parentId !== undefined) {
      const parent = byId.get(el.parentId);
      if (!parent || parent.type !== 'frame' || parent.id === el.id) {
        problems.push(`Element ${el.id} has parentId ${el.parentId} that is not an existing frame`);
      }
    }
    if (el.type === 'edge') {
      if (!byId.has(el.sourceId)) problems.push(`Edge ${el.id} sourceId ${el.sourceId} does not exist`);
      if (!byId.has(el.targetId)) problems.push(`Edge ${el.id} targetId ${el.targetId} does not exist`);
    }
    if (el.type === 'image' && !assetIds.has(el.assetId)) {
      problems.push(`Image ${el.id} references missing asset ${el.assetId}`);
    }
  }
  for (const el of doc.elements) {
    if (el.type === 'frame' && el.component !== undefined && el.instanceOf !== undefined) {
      problems.push(`Frame ${el.id} is both a Component_Master and a Component_Instance`);
    }
  }
  const libIds = new Set<string>();
  for (const c of doc.library) {
    if (libIds.has(c.id)) problems.push(`Duplicate library component id: ${c.id}`);
    libIds.add(c.id);
  }
  problems.push(...checkTokenInvariants(doc));
  return problems;
}

/** Defense in depth for the token collection: names, uniqueness, limits, and literal-only values. */
function checkTokenInvariants(doc: BoardDocument): string[] {
  const problems: string[] = [];
  if (!doc.tokens) return problems;
  for (const category of TOKEN_CATEGORIES) {
    const bucket = doc.tokens[category] as Record<string, unknown> | undefined;
    if (!bucket) continue;
    const names = Object.keys(bucket);
    if (names.length > MAX_TOKENS_PER_CATEGORY) {
      problems.push(`Token category ${category} holds ${names.length} tokens (limit ${MAX_TOKENS_PER_CATEGORY})`);
    }
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) problems.push(`Duplicate ${category} token name: ${name}`);
      seen.add(name);
      if (!validateTokenName(name).ok) problems.push(`Invalid ${category} token name: ${name}`);
      const v = validateTokenValue(category, bucket[name]);
      if (!v.ok) problems.push(`Invalid ${category} token "${name}": ${v.message}`);
    }
  }
  return problems;
}

export class InvariantError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Board invariant violation: ${problems.join('; ')}`);
    this.name = 'InvariantError';
    this.problems = problems;
  }
}
