import type { BoardDocument } from '../model/types';

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
  const libIds = new Set<string>();
  for (const c of doc.library) {
    if (libIds.has(c.id)) problems.push(`Duplicate library component id: ${c.id}`);
    libIds.add(c.id);
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
