/**
 * Export actions wired to the transport: host `render:request` handling (Req 12.1, 12.10) and
 * Copy as PNG (Req 12.11). Dependencies are injected so the flow is testable without a DOM.
 */
import { renderToSvg } from '../../core/export/svg';
import { prepareExport } from '../../core/export/scope';
import type { BoardDocument, ElementId } from '../../core/model/types';
import type { RenderSpec, WebviewToHost } from '../../shared/messages';
import { copyOptions } from './model';
import {
  COPY_FAILED_MESSAGE,
  describeRasterError,
  EXPORT_NOT_COMPLETED_MESSAGE,
  parseRenderSpec,
  RASTER_MIME,
  type RasterSpec,
} from './plan';

export interface RenderDeps {
  send(message: WebviewToHost): void;
  notify(level: 'info' | 'warn' | 'error', message: string): void;
  /** Rasterize to base64 (throws on refusal or failure). */
  rasterize(spec: RasterSpec): Promise<string>;
}

/**
 * Answers one `render:request`. On success replies `render:result` (or `export:result` when the
 * spec asks for it). On failure sends `export:cancel` so the host removes any partial output and
 * shows the "not completed" message, and tells the user why.
 */
export async function handleRenderRequest(deps: RenderDeps, requestId: string, raw: RenderSpec): Promise<void> {
  const parsed = parseRenderSpec(raw);
  if (!parsed.ok) {
    deps.notify('error', parsed.message);
    deps.send({ type: 'export:cancel', requestId, reason: parsed.message });
    return;
  }
  const { spec } = parsed;
  try {
    const b64 = await deps.rasterize(spec);
    if (spec.reply === 'export') deps.send({ type: 'export:result', requestId, bytes: b64, mime: RASTER_MIME[spec.format] });
    else deps.send({ type: 'render:result', requestId, png: b64 });
  } catch (err) {
    const message = describeRasterError(err);
    deps.notify('error', message);
    deps.send({ type: 'export:cancel', requestId, reason: message || EXPORT_NOT_COMPLETED_MESSAGE });
  }
}

export interface CopyDeps {
  notify(level: 'info' | 'warn' | 'error', message: string): void;
  /** Rasterize to a PNG Blob. */
  rasterize(spec: RasterSpec): Promise<Blob>;
  /** Writes the PNG blob to the clipboard (rejects on failure). */
  writeClipboard(png: Blob): Promise<void>;
}

/** Copy as PNG: the selection (or whole board) rendered at 1x on a white background. Returns success. */
export async function copyAsPng(
  deps: CopyDeps,
  doc: Pick<BoardDocument, 'assets' | 'elements'>,
  selection: readonly ElementId[],
): Promise<boolean> {
  const opts = copyOptions(selection);
  const prep = prepareExport(doc, opts);
  if (!prep.ok) {
    deps.notify('error', prep.error.message);
    return false;
  }
  const svg = renderToSvg(doc, prep.value.elements, { padding: 0, background: 'white', matchTheme: false });
  if (!svg.ok) {
    deps.notify('error', svg.error.message);
    return false;
  }
  try {
    const png = await deps.rasterize({
      svg: svg.value.svg,
      format: 'png',
      scale: 1,
      width: svg.value.width,
      height: svg.value.height,
      background: 'white',
      reply: 'render',
    });
    await deps.writeClipboard(png);
    return true;
  } catch {
    deps.notify('error', COPY_FAILED_MESSAGE);
    return false;
  }
}

/** Browser clipboard writer (navigator.clipboard.write with a ClipboardItem). */
export async function writePngToClipboard(png: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('clipboard unavailable');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
