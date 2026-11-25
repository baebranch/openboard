/**
 * Pure render-cache key plumbing. `renderContextKey` folds every external input that can change an
 * element's rendered SVG without changing the element object itself: resolved design tokens,
 * referenced Asset content, clipping ancestors, and master revision for instance children.
 * Each contribution is the empty string while its feature is absent, so the key is a no-op then.
 */
import type { Asset, Element } from '../model/types';
import { scanTokenReferences } from '../tokens/references';
import { colorForMode } from '../tokens/resolve';
import type { TokenCollection, TokenMode, TokenValue } from '../tokens/types';

/**
 * Resolved values (keyed `category.name`) of the tokens `el` references, for `RenderKeyContext.tokens`.
 * A missing token maps to the empty string, so creating it later changes the key. Undefined when the
 * element references no token, which keeps the key a no-op for documents without tokens.
 */
export function usedTokenValues(
  el: Element,
  tokens: TokenCollection | undefined,
  mode: TokenMode = 'light',
): Record<string, string> | undefined {
  const refs = scanTokenReferences(el);
  if (refs.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const r of refs) {
    const v = (tokens?.[r.category] as Record<string, TokenValue> | undefined)?.[r.name];
    out[`${r.category}.${r.name}`] = v === undefined ? '' : typeof v === 'object' ? colorForMode(v, mode) : String(v);
  }
  return out;
}

export interface RenderKeyContext {
  /** Resolved token values (name -> value) actually used by the element. */
  tokens?: Readonly<Record<string, string>>;
  /** Asset store, used to look up the content hash of the element's referenced asset. */
  assets?: readonly Asset[];
  /** Ids of clipping ancestors, outermost first. */
  clipAncestors?: readonly string[];
  /** Revision of the master for Instance_Children. */
  masterRevision?: number | string;
}

export function renderContextKey(el: Element, ctx: RenderKeyContext = {}): string {
  const tokens = ctx.tokens
    ? Object.keys(ctx.tokens)
        .sort()
        .map((k) => `${k}=${ctx.tokens![k]}`)
        .join(',')
    : '';
  const assetId = (el as { assetId?: string }).assetId;
  const asset = assetId && ctx.assets ? ctx.assets.find((a) => a.id === assetId) : undefined;
  const fillId = el.style.imageFill?.assetId;
  const fillAsset = fillId && ctx.assets ? ctx.assets.find((a) => a.id === fillId) : undefined;
  const clips = ctx.clipAncestors?.join('>') ?? '';
  const rev = ctx.masterRevision === undefined ? '' : String(ctx.masterRevision);
  if (!tokens && !asset && !fillAsset && !clips && !rev) return '';
  const fill = fillAsset ? `|f:${fillAsset.hash}` : '';
  return `t:${tokens}|a:${asset?.hash ?? ''}|c:${clips}|m:${rev}${fill}`;
}
