/** Pure fit geometry for image fills (Req 9.3-9.5). No I/O. */

export type ImageFit = 'cover' | 'contain' | 'stretch';

export interface FitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns the drawn image rectangle for the given fit mode.
 * cover: smallest uniform scale covering the box; contain: largest uniform scale inside it; stretch: exactly the box.
 * Cover and contain center the image on the box. Invalid image dimensions fall back to the box itself.
 */
export function fitImage(imgW: number, imgH: number, box: FitBox, fit: ImageFit): FitBox {
  if (fit === 'stretch' || !(imgW > 0) || !(imgH > 0) || !Number.isFinite(imgW) || !Number.isFinite(imgH)) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const sx = box.width / imgW;
  const sy = box.height / imgH;
  const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = imgW * s;
  const height = imgH * s;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}
