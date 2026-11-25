/** Image validation and sizing (Req 7.2-7.7, 7.9, 7.12). Pure, no I/O. */

export type ImageMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml';

export const MAX_IMAGE_BYTES = 26_214_400; // 25 MB, inclusive
export const MAX_IMAGE_SIDE = 1024;
export const MAX_ALT_TEXT_LENGTH = 500;
export const ACCEPTED_IMAGE_TYPES_MESSAGE = 'Accepted image types: PNG, JPEG, GIF, WebP, SVG.';
export const IMAGE_TOO_LARGE_MESSAGE = 'Image exceeds the 25 MB limit.';
export const IMAGE_UNREADABLE_MESSAGE = 'The image could not be read.';

export type ImageRejection = 'unsupported-type' | 'too-large' | 'undecodable';

export type ImageValidation =
  | { ok: true; mime: ImageMime; size: number }
  | { ok: false; reason: ImageRejection; message: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

function looksLikeSvg(bytes: Uint8Array): boolean {
  let s = '';
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] ?? 0);
  s = s.replace(/^\u00ef\u00bb\u00bf/, '').trimStart();
  // Strip leading XML declaration, comments, and doctype.
  for (;;) {
    const m = /^(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*/i.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return /^<svg[\s>/]/i.test(s);
}

/** Detects the content type from magic bytes; undefined when unsupported. */
export function detectImageType(bytes: Uint8Array): ImageMime | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  if (looksLikeSvg(bytes)) return 'image/svg+xml';
  return undefined;
}

/** Validates type then size. `size` defaults to bytes.length. */
export function validateImageFile(bytes: Uint8Array, size: number = bytes.length): ImageValidation {
  const mime = detectImageType(bytes);
  if (!mime) {
    return { ok: false, reason: 'unsupported-type', message: ACCEPTED_IMAGE_TYPES_MESSAGE };
  }
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'too-large', message: IMAGE_TOO_LARGE_MESSAGE };
  }
  return { ok: true, mime, size };
}

/** Each file is judged independently; results preserve input order. */
export function validateImageBatch(
  files: ReadonlyArray<{ bytes: Uint8Array; size?: number }>,
): ImageValidation[] {
  return files.map((f) => validateImageFile(f.bytes, f.size));
}

export interface Size {
  width: number;
  height: number;
}

/** Natural size, scaled proportionally so the longer side is at most 1,024. */
export function sizeForNaturalDimensions(width: number, height: number): Size {
  const longer = Math.max(width, height);
  if (!(longer > MAX_IMAGE_SIDE)) return { width, height };
  const k = MAX_IMAGE_SIDE / longer;
  return width >= height
    ? { width: MAX_IMAGE_SIDE, height: height * k }
    : { width: width * k, height: MAX_IMAGE_SIDE };
}

/** Replace-source rule: keep position, rotation, width; height follows new aspect ratio. */
export function replaceImageSource<T extends { x: number; y: number; rotation: number; width: number; height: number }>(
  el: T,
  natural: Size,
): T {
  return { ...el, height: (el.width * natural.height) / natural.width };
}

/** True when alt text is within 500 characters. */
export function isValidAltText(alt: string): boolean {
  return alt.length <= MAX_ALT_TEXT_LENGTH;
}
