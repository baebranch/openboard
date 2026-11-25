import type { BoardDocument } from '../model/types';
import { scanTokenReferences } from '../tokens/references';
import { TOKEN_CATEGORIES } from '../tokens/types';

/** Req 11.14: at least one Token in the collection. */
function hasTokens(doc: BoardDocument): boolean {
  const tokens = doc.tokens;
  if (!tokens) return false;
  return TOKEN_CATEGORIES.some((c) => {
    const entries = tokens[c];
    return entries !== undefined && Object.keys(entries).length > 0;
  });
}

/** Req 11.14: at least one Token_Reference in an element or Library entry. */
function hasTokenReference(doc: BoardDocument): boolean {
  return scanTokenReferences({ elements: doc.elements, library: doc.library }).length > 0;
}

/** Req 13.11, 14.16: a Frame that is a Component_Master or Component_Instance. */
function hasComponentField(doc: BoardDocument): boolean {
  return doc.elements.some((el) => el.type === 'frame' && (el.component !== undefined || el.instanceOf !== undefined));
}

/** Req 19.12, 20.1: a Layout_Frame, or any element with `sizing` or `ignoreLayout`. */
function hasLayoutField(doc: BoardDocument): boolean {
  return doc.elements.some(
    (el) =>
      (el.type === 'frame' && el.layout !== undefined) || el.sizing !== undefined || el.ignoreLayout !== undefined,
  );
}

/** Req 23.12: at least one Icon element. */
function hasIcon(doc: BoardDocument): boolean {
  return doc.elements.some((el) => el.type === 'icon');
}

/**
 * True when the document uses any feature that only exists in schema version 2.
 * Each Schema_V2_Feature adds its own clause here.
 */
export function hasSchemaV2Feature(doc: BoardDocument): boolean {
  return (
    hasTokens(doc) ||
    hasTokenReference(doc) ||
    doc.settings?.activeMode !== undefined ||
    hasComponentField(doc) ||
    hasLayoutField(doc) ||
    hasIcon(doc)
  );
}

/** The lowest schema version able to represent the document (Req 3.1-3.3). */
export function effectiveSchemaVersion(doc: BoardDocument): number {
  return hasSchemaV2Feature(doc) ? 2 : 1;
}
