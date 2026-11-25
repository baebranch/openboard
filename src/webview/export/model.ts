/**
 * Pure export-dialog logic (Req 12.1 to 12.6, 12.12, 12.13): form state, option building,
 * size preview and the tool input for `openboard.export`. No DOM.
 */
import {
  DEFAULT_EXPORT_OPTIONS,
  EMPTY_SCOPE_MESSAGE,
  EXPORT_PADDING_MAX,
  isRaster,
  prepareExport,
  resolvePadding,
  selectFrameScopes,
  type ExportBackground,
  type ExportFormat,
  type ExportOptions,
  type ExportScale,
  type ExportScope,
} from '../../core/export/scope';
import type { BoardDocument, ElementId } from '../../core/model/types';

export type ScopeKind = 'board' | 'selection' | 'frame' | 'allFrames';

export interface DialogState {
  format: ExportFormat;
  scopeKind: ScopeKind;
  frameId: ElementId | undefined;
  scale: ExportScale;
  /** Last valid padding. */
  padding: number;
  /** Raw text in the padding field. */
  paddingText: string;
  background: ExportBackground;
  matchTheme: boolean;
  /** Token mode to export in (Req 12.5); `active` follows the board's stored mode. */
  tokenMode: 'active' | 'light' | 'dark';
  embedBoard: boolean;
  /** Omit Component_Masters from the output (Req 17.1); off on every export initiation. */
  excludeMasters: boolean;
}

export const initialDialogState = (): DialogState => ({
  format: DEFAULT_EXPORT_OPTIONS.format,
  scopeKind: 'board',
  frameId: undefined,
  scale: DEFAULT_EXPORT_OPTIONS.scale,
  padding: DEFAULT_EXPORT_OPTIONS.padding,
  paddingText: String(DEFAULT_EXPORT_OPTIONS.padding),
  background: DEFAULT_EXPORT_OPTIONS.background,
  matchTheme: false,
  tokenMode: 'active',
  embedBoard: false,
  excludeMasters: false,
});

/** Parses the padding field; an invalid entry keeps the previous value and reports the range (Req 12.6). */
export function applyPaddingInput(state: DialogState, text: string): { state: DialogState; error?: string } {
  const trimmed = text.trim();
  const candidate = /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  const r = resolvePadding(candidate, state.padding);
  if (r.error) {
    return { state: { ...state, padding: r.value, paddingText: String(r.value) }, error: r.error.message };
  }
  return { state: { ...state, padding: r.value, paddingText: String(r.value) } };
}

export const supportsTransparency = (f: ExportFormat): boolean => f === 'png' || f === 'webp';
export const supportsScale = isRaster;

/** Changes the format and drops options the new format does not support. */
export function setFormat(state: DialogState, format: ExportFormat): DialogState {
  const next = { ...state, format };
  if (!supportsTransparency(format) && next.background === 'transparent') next.background = 'white';
  if (format !== 'png') next.embedBoard = false;
  return next;
}

function scopeOf(state: DialogState, selection: readonly ElementId[]): ExportScope {
  switch (state.scopeKind) {
    case 'selection':
      return { kind: 'selection', ids: [...selection] };
    case 'frame':
      return { kind: 'frame', id: state.frameId ?? '' };
    case 'allFrames':
      return { kind: 'allFrames' };
    default:
      return { kind: 'board' };
  }
}

/** Builds the (normalised) ExportOptions for the current form. */
export function buildOptions(state: DialogState, selection: readonly ElementId[]): ExportOptions {
  const opts: ExportOptions = {
    format: state.format,
    scope: scopeOf(state, selection),
    scale: isRaster(state.format) ? state.scale : 1,
    padding: state.padding,
    background: !supportsTransparency(state.format) && state.background === 'transparent' ? 'white' : state.background,
    matchTheme: state.matchTheme,
  };
  if (state.tokenMode !== 'active') opts.tokenMode = state.tokenMode;
  if (state.format === 'png' && state.embedBoard) opts.embedBoard = true;
  if (state.excludeMasters) opts.excludeMasters = true;
  return opts;
}

export interface Preview {
  ok: boolean;
  /** Output pixel sizes, one per file (several for all-Frames). Empty on error. */
  sizes: { w: number; h: number }[];
  /** Error shown in the dialog (empty scope or the 16,384 px limit). */
  error?: string;
}

/** Validates with prepareExport for each file the export will produce. */
export function previewExport(doc: Pick<BoardDocument, 'elements'>, opts: ExportOptions): Preview {
  const regions: ExportOptions[] =
    opts.scope.kind === 'allFrames'
      ? selectFrameScopes(doc, { excludeMasters: opts.excludeMasters === true }).map(({ frame }) => ({ ...opts, scope: { kind: 'frame', id: frame.id } as ExportScope }))
      : [opts];
  if (regions.length === 0) return { ok: false, sizes: [], error: EMPTY_SCOPE_MESSAGE };
  const sizes: { w: number; h: number }[] = [];
  for (const r of regions) {
    const p = prepareExport(doc, r);
    if (!p.ok) return { ok: false, sizes: [], error: p.error.message };
    sizes.push({ w: p.value.w, h: p.value.h });
  }
  return { ok: true, sizes };
}

/** Human text for a size preview. */
export function describePreview(p: Preview): string {
  if (!p.ok) return p.error ?? '';
  if (p.sizes.length === 1) return `${p.sizes[0]!.w} × ${p.sizes[0]!.h} px`;
  return `${p.sizes.length} files`;
}

/** Input for `dispatchOp('openboard.export', ...)`; the host prompts for the destination (Req 12.9). */
export function toToolInput(opts: ExportOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {
    format: opts.format,
    scope: opts.scope.kind,
    scale: opts.scale,
    padding: opts.padding,
    background: opts.background,
    matchTheme: opts.matchTheme,
  };
  if (opts.scope.kind === 'selection') input['ids'] = [...opts.scope.ids];
  if (opts.scope.kind === 'frame') input['frameId'] = opts.scope.id;
  if (opts.tokenMode && opts.tokenMode !== 'active') input['tokenMode'] = opts.tokenMode;
  if (opts.embedBoard) input['embedBoard'] = true;
  if (opts.excludeMasters) input['excludeMasters'] = true;
  return input;
}

/** Options for "Copy as PNG": the selection when there is one, otherwise the whole board. */
export function copyOptions(selection: readonly ElementId[]): ExportOptions {
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    format: 'png',
    scope: selection.length > 0 ? { kind: 'selection', ids: [...selection] } : { kind: 'board' },
    scale: 1,
    padding: 0,
    background: 'white',
    matchTheme: false,
  };
}

export const PADDING_MAX = EXPORT_PADDING_MAX;
