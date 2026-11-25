/**
 * Pure rasterize planning for the webview (Req 12.1, 12.9 to 12.11): parses the host's
 * `render:request` spec, computes pixel sizes, refuses remote references and maps failures to messages.
 * No DOM access; the canvas work lives in rasterizer.ts.
 */
import { EXPORT_MAX_PIXELS, EXPORT_SCALES, SIZE_LIMIT_MESSAGE } from '../../core/export/scope';

export type RasterFormat = 'png' | 'jpeg' | 'webp';
export type RasterBackground = 'transparent' | 'white' | 'theme';

export const RASTER_FORMATS: readonly RasterFormat[] = ['png', 'jpeg', 'webp'];
export const RASTER_MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Normalised render request. `reply` selects the result message type. */
export interface RasterSpec {
  svg: string;
  format: RasterFormat;
  scale: number;
  /** SVG size in user units. */
  width: number;
  height: number;
  background: RasterBackground;
  reply: 'render' | 'export';
}

export interface RasterPlan {
  spec: RasterSpec;
  pixelWidth: number;
  pixelHeight: number;
  mime: string;
  /** Encoder quality for lossy formats. */
  quality: number | undefined;
  /** Colour painted under the SVG, or undefined to keep transparency. */
  fill: string | undefined;
}

export type PlanResult = { ok: true; plan: RasterPlan } | { ok: false; message: string };

export const RENDER_FAILED_MESSAGE = 'The export was not completed: the image could not be rendered.';
export const RENDER_REMOTE_MESSAGE = 'The export was not completed: the board references an external resource.';
export const COPY_FAILED_MESSAGE = 'Copy as PNG failed: the image could not be placed on the clipboard.';
export const COPY_NOTHING_MESSAGE = 'There is nothing to export.';
export const EXPORT_NOT_COMPLETED_MESSAGE = 'The export was not completed.';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses an untrusted render spec into a RasterSpec, or returns an error message. */
export function parseRenderSpec(raw: unknown): { ok: true; spec: RasterSpec } | { ok: false; message: string } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r['svg'] !== 'string' || r['svg'].length === 0) return { ok: false, message: RENDER_FAILED_MESSAGE };
  const format = (r['format'] ?? 'png') as RasterFormat;
  if (!RASTER_FORMATS.includes(format)) return { ok: false, message: RENDER_FAILED_MESSAGE };
  const scale = r['scale'] === undefined ? 1 : r['scale'];
  if (!isNum(scale) || !(EXPORT_SCALES as readonly number[]).includes(scale)) {
    return { ok: false, message: RENDER_FAILED_MESSAGE };
  }
  const width = r['width'];
  const height = r['height'];
  if (!isNum(width) || !isNum(height) || width <= 0 || height <= 0) return { ok: false, message: RENDER_FAILED_MESSAGE };
  const bg = (r['background'] ?? 'white') as RasterBackground;
  if (bg !== 'transparent' && bg !== 'white' && bg !== 'theme') return { ok: false, message: RENDER_FAILED_MESSAGE };
  return {
    ok: true,
    spec: { svg: r['svg'], format, scale, width, height, background: bg, reply: r['reply'] === 'export' ? 'export' : 'render' },
  };
}

/** True when the SVG would make the browser fetch something other than data:/fragment URLs (Req 12.7). */
export function hasRemoteReference(svg: string): boolean {
  if (/\b(?:xlink:)?(?:href|src)\s*=\s*["']\s*(?:https?:|ftp:|file:|\/\/)/i.test(svg)) return true;
  if (/url\(\s*["']?\s*(?:https?:|ftp:|file:|\/\/)/i.test(svg)) return true;
  if (/@import/i.test(svg)) return true;
  return false;
}

/** Plans one rasterization: pixel size, limits, encoder settings and the under-fill (Req 12.3, 12.13). */
export function planRaster(spec: RasterSpec): PlanResult {
  if (hasRemoteReference(spec.svg)) return { ok: false, message: RENDER_REMOTE_MESSAGE };
  const pixelWidth = Math.ceil(spec.width * spec.scale);
  const pixelHeight = Math.ceil(spec.height * spec.scale);
  if (pixelWidth > EXPORT_MAX_PIXELS || pixelHeight > EXPORT_MAX_PIXELS) return { ok: false, message: SIZE_LIMIT_MESSAGE };
  // JPEG has no alpha: anything the SVG leaves transparent is flattened onto white.
  const fill = spec.format === 'jpeg' ? '#ffffff' : undefined;
  return {
    ok: true,
    plan: {
      spec,
      pixelWidth,
      pixelHeight,
      mime: RASTER_MIME[spec.format],
      quality: spec.format === 'png' ? undefined : 0.92,
      fill,
    },
  };
}

/** Spec for PDF page rasters: JPEG at 1x (consumed by core/export/pdf). */
export function pdfPageSpec(svg: string, width: number, height: number, background: RasterBackground): RasterSpec {
  return { svg, format: 'jpeg', scale: 1, width, height, background, reply: 'render' };
}

/** Base64 of a byte array (chunked so large images do not overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A refusal whose message is already user-facing. */
export class PlanError extends Error {}

/** Message for a thrown error during rasterization or encoding. */
export function describeRasterError(err: unknown): string {
  if (err instanceof PlanError) return err.message;
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return `${RENDER_FAILED_MESSAGE.slice(0, -1)}${detail}.`;
}
