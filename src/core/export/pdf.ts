import { deflateSync } from 'node:zlib';

/** A JPEG-encoded page (embedded as a DCT stream). */
export interface PdfJpegPage {
  /** Page width in points. */
  width: number;
  /** Page height in points. */
  height: number;
  /** Pixel width of the JPEG (defaults to width). */
  pixelWidth?: number;
  /** Pixel height of the JPEG (defaults to height). */
  pixelHeight?: number;
  jpeg: Uint8Array;
}

/** A raw RGB page (3 bytes per pixel, row-major; Flate-compressed on write). */
export interface PdfRgbPage {
  width: number;
  height: number;
  pixelWidth?: number;
  pixelHeight?: number;
  rgb: Uint8Array;
}

export type PdfPage = PdfJpegPage | PdfRgbPage;

function num(n: number): string {
  if (!Number.isFinite(n) || n <= 0) throw new Error('PDF page dimensions must be positive');
  return String(Math.round(n * 1000) / 1000);
}

function int(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * Write a minimal PDF 1.4 document, one page per export region, each page the
 * size of its region (in points) and filled by a single raster image (Req 12.1).
 */
export function writePdf(pages: readonly PdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('PDF requires at least one page');
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (b: Uint8Array | string): void => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObj = (id: number): void => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // Object layout: 1 catalog, 2 pages, then per page i: page, content, image.
  const objCount = 2 + pages.length * 3;
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObj(2);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const w = num(page.width);
    const h = num(page.height);

    beginObj(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
    beginObj(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

    const pw = int(page.pixelWidth ?? page.width);
    const ph = int(page.pixelHeight ?? page.height);
    let data: Uint8Array;
    let filter: string;
    if ('jpeg' in page) {
      data = page.jpeg;
      filter = '/Filter /DCTDecode';
    } else {
      if (page.rgb.length !== pw * ph * 3) {
        throw new Error('RGB data length does not match pixel dimensions');
      }
      data = new Uint8Array(deflateSync(page.rgb));
      filter = '/Filter /FlateDecode';
    }
    beginObj(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ${filter} /Length ${data.length} >>\nstream\n`,
    );
    push(data);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objCount; id++) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
