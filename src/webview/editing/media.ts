/**
 * Pure paste classification and image-file batch handling (Req 7.1, 7.8, 8.11, 8.12).
 * Decoding natural dimensions and reading files are injected, so this stays DOM-free.
 */
import { isValidAltText, replaceImageSource, validateImageFile, IMAGE_UNREADABLE_MESSAGE, type Size } from '../../core/image';
import { isMermaidError, parseMermaid } from '../../core/mermaid';
import type { ElementId, ImageElement } from '../../core/model/types';
import type { Op } from '../canvas/gestures';

export const TOOL_IMPORT = 'openboard.import';

// --- Mermaid paste ---------------------------------------------------------------------------------

export type PasteClass =
  | { kind: 'mermaid'; op: Op }
  | { kind: 'mermaid-error'; line: number; message: string }
  | { kind: 'other' };

const MERMAID_HEAD = /^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\b/i;

/** Classify clipboard text: Mermaid flowcharts import; a broken flowchart reports its line. */
export function classifyPasteText(text: string, at?: { x: number; y: number }): PasteClass {
  if (!MERMAID_HEAD.test(text)) return { kind: 'other' };
  const parsed = parseMermaid(text);
  if (isMermaidError(parsed)) {
    const { line, message } = parsed.error;
    return { kind: 'mermaid-error', line, message: `Mermaid error on line ${line}: ${message}` };
  }
  return { kind: 'mermaid', op: { tool: TOOL_IMPORT, input: { source: 'mermaid', text, ...(at ?? {}) } } };
}

// --- image batches ---------------------------------------------------------------------------------

export interface RawImageFile {
  name: string;
  bytes: Uint8Array;
  size?: number;
}

export interface ImageRejection {
  name: string;
  message: string;
}

export interface ImportPlan {
  ops: Op[];
  rejected: ImageRejection[];
}

export type DecodeFn = (bytes: Uint8Array, mime: string) => Promise<Size | undefined>;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/**
 * Judge every file on its own: valid, decodable files become one import op each (laid out left to
 * right from `at`); the rest are reported. A rejected file never changes the board.
 */
export async function planImageImports(
  files: readonly RawImageFile[],
  decode: DecodeFn,
  at: { x: number; y: number },
  extra: Record<string, unknown> = {},
): Promise<ImportPlan> {
  const ops: Op[] = [];
  const rejected: ImageRejection[] = [];
  let offset = 0;
  for (const f of files) {
    const v = validateImageFile(f.bytes, f.size);
    if (!v.ok) {
      rejected.push({ name: f.name, message: v.message });
      continue;
    }
    let natural: Size | undefined;
    try {
      natural = await decode(f.bytes, v.mime);
    } catch {
      natural = undefined;
    }
    if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
      rejected.push({ name: f.name, message: IMAGE_UNREADABLE_MESSAGE });
      continue;
    }
    ops.push({
      tool: TOOL_IMPORT,
      input: { source: 'image', data: bytesToBase64(f.bytes), width: natural.width, height: natural.height, x: at.x + offset, y: at.y + offset, ...extra },
    });
    offset += 20;
  }
  return { ops, rejected };
}

/** Rejection text shown to the user, one line per file. */
export function rejectionMessages(rejected: readonly ImageRejection[]): string[] {
  return rejected.map((r) => (r.name ? `${r.name}: ${r.message}` : r.message));
}

/** Replace-source plan: one op; a rejected replacement yields no op (original kept). */
export async function planReplaceSource(
  el: Pick<ImageElement, 'id'>,
  file: RawImageFile,
  decode: DecodeFn,
): Promise<{ op?: Op; rejected?: ImageRejection }> {
  const plan = await planImageImports([file], decode, { x: 0, y: 0 }, { replace: el.id });
  const op = plan.ops[0];
  if (!op) return { rejected: plan.rejected[0] ?? { name: file.name, message: IMAGE_UNREADABLE_MESSAGE } };
  const input = op.input as Record<string, unknown>;
  delete input['x'];
  delete input['y'];
  return { op };
}

/** Preview of the height a replacement will produce (position/rotation/width are kept). */
export function replacedHeight(el: ImageElement, natural: Size): number {
  return replaceImageSource(el, natural).height;
}

// --- crop / alt ------------------------------------------------------------------------------------

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a crop rectangle into the natural image; undefined when it would be empty. */
export function clampCrop(c: CropRect, natural: Size): CropRect | undefined {
  const x = Math.min(Math.max(0, c.x), natural.width);
  const y = Math.min(Math.max(0, c.y), natural.height);
  const w = Math.min(c.w, natural.width - x);
  const h = Math.min(c.h, natural.height - y);
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

export function cropOp(id: ElementId, crop: CropRect): Op {
  return { tool: 'openboard.element.update', input: { ids: [id], set: { crop } } };
}

/** Alt-text update; undefined (no op) when over the 500-character limit. */
export function altTextOp(id: ElementId, alt: string): Op | undefined {
  return isValidAltText(alt) ? { tool: 'openboard.element.update', input: { ids: [id], set: { alt } } } : undefined;
}
