/**
 * Thin DOM layer: SVG string -> Blob URL -> Image -> canvas.toBlob (Req 12.1). All decisions
 * (limits, remote refs, fill, quality) come from plan.ts. Never loads anything remote.
 */
import { base64ToBytes, bytesToBase64, pdfPageSpec, PlanError, planRaster, type RasterBackground, type RasterPlan, type RasterSpec } from './plan';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the SVG could not be decoded'));
    img.src = url;
  });
}

/** Rasterizes a plan to an encoded image Blob. */
export async function rasterizePlan(plan: RasterPlan): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([plan.spec.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = plan.pixelWidth;
    canvas.height = plan.pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas context');
    if (plan.fill) {
      ctx.fillStyle = plan.fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, plan.pixelWidth, plan.pixelHeight);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.mime, plan.quality));
    if (!blob || blob.type !== plan.mime) throw new Error(`the ${plan.mime} encoder is unavailable`);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Plans and rasterizes a spec; rejects with the plan's message when it is refused. */
export async function rasterize(spec: RasterSpec): Promise<Blob> {
  const planned = planRaster(spec);
  if (!planned.ok) throw new PlanError(planned.message);
  return rasterizePlan(planned.plan);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** JPEG bytes for one PDF page (consumed by core/export/pdf). */
export async function rasterizePdfPage(svg: string, width: number, height: number, background: RasterBackground): Promise<Uint8Array> {
  const blob = await rasterize(pdfPageSpec(svg, width, height, background));
  return base64ToBytes(await blobToBase64(blob));
}
