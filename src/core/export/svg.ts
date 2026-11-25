/**
 * Shared pure SVG renderer used for both canvas and export (Req 12.3, 12.7, 12.14, 4.8).
 * No DOM or vscode imports. The output is self-contained: assets are inlined as data URIs and
 * nothing references an external resource (the only URL is the SVG namespace declaration).
 */
import { getFlowNodePreset } from '../flow/presets';
import { routeEdgeElement, type EdgeRoute } from '../flow/routing';
import { pressureWidth } from '../freehand';
import { center } from '../model/geometry';
import type {
  ArrowHead,
  Asset,
  BoardDocument,
  Bounds,
  EdgeElement,
  Element,
  FlowNodeElement,
  FreehandElement,
  ImageElement,
  Point,
  TextAlign,
  TextRun,
} from '../model/types';
import { builtinPalette, parseColor, resolveElementColor, type ThemePalette } from '../theme';
import { contentBounds, selectScope, type ExportBackground, type ExportError, type ExportResult, type ExportScope } from './scope';

export interface RenderSvgOptions {
  /** Integer padding around the content bounds. Default 0. */
  padding?: number;
  /** Default 'white'. 'theme' fills with the palette background only when matchTheme is on. */
  background?: ExportBackground;
  /** When off, the light default palette and a white background are used (Req 4.8). */
  matchTheme?: boolean;
  /** Palette used when matchTheme is on. Defaults to the built-in dark palette. */
  palette?: ThemePalette;
}

export interface SvgOutput {
  svg: string;
  /** Output size in user units (content bounds plus padding). */
  width: number;
  height: number;
  /** Content bounds in document coordinates (without padding). */
  bounds: Bounds;
}

const EMPTY: ExportError = { code: 'empty-scope', message: 'There is nothing to export.' };

/** Escapes text for use in XML text nodes and attribute values. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Strip characters that are invalid in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

const num = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0');

interface Ctx {
  palette: ThemePalette;
  assets: Map<string, Asset>;
  byId: Map<string, Element>;
}

function colorOf(value: string, ctx: Ctx, role: 'stroke' | 'text' = 'stroke'): string {
  const c = resolveElementColor(value, ctx.palette, role);
  return parseColor(c) ? c : ctx.palette.defaultStroke;
}

function fillOf(el: Element, ctx: Ctx): string {
  if (el.style.fill === 'theme:default') return el.type === 'sticky' ? '#fff59d' : 'none';
  return colorOf(el.style.fill, ctx);
}

function dashOf(el: Element): string {
  const w = Math.max(el.style.strokeWidth, 1);
  if (el.style.strokeStyle === 'dashed') return ` stroke-dasharray="${num(w * 4)} ${num(w * 3)}"`;
  if (el.style.strokeStyle === 'dotted') return ` stroke-dasharray="${num(w)} ${num(w * 2)}" stroke-linecap="round"`;
  return '';
}

function strokeAttrs(el: Element, ctx: Ctx): string {
  const w = el.style.strokeWidth;
  if (w <= 0) return ' stroke="none"';
  return ` stroke="${escapeXml(colorOf(el.style.stroke, ctx))}" stroke-width="${num(w)}"${dashOf(el)}`;
}

function wrap(el: Element, inner: string): string {
  const attrs: string[] = [`data-id="${escapeXml(el.id)}"`];
  if (el.rotation) {
    const c = center(el);
    attrs.push(`transform="rotate(${num(el.rotation)} ${num(c.x)} ${num(c.y)})"`);
  }
  const op = Math.min(100, Math.max(0, el.style.opacity));
  if (op < 100) attrs.push(`opacity="${num(op / 100)}"`);
  return `<g ${attrs.join(' ')}>${inner}</g>`;
}

function textLines(runs: readonly TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split(/\r\n|\r|\n/);
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1]!.push({ ...run, text: part });
    });
  }
  return lines;
}

function renderText(
  box: Bounds,
  t: { runs: TextRun[]; fontFamily: string; fontSize: number; align: TextAlign },
  color: string,
  vcenter: boolean,
  pad = 0,
): string {
  const lines = textLines(t.runs);
  const lh = t.fontSize * 1.2;
  const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
  const x = t.align === 'center' ? box.x + box.width / 2 : t.align === 'right' ? box.x + box.width - pad : box.x + pad;
  const total = lh * lines.length;
  const top = vcenter ? box.y + (box.height - total) / 2 : box.y + pad;
  const out = lines.map((line, i) => {
    const y = top + lh * i + t.fontSize;
    const spans = line
      .map((r) => {
        const a: string[] = [];
        if (r.bold) a.push('font-weight="bold"');
        if (r.italic) a.push('font-style="italic"');
        if (r.underline) a.push('text-decoration="underline"');
        return `<tspan${a.length ? ' ' + a.join(' ') : ''}>${escapeXml(r.text)}</tspan>`;
      })
      .join('');
    return `<text x="${num(x)}" y="${num(y)}" xml:space="preserve">${spans}</text>`;
  });
  return `<g font-family="${escapeXml(t.fontFamily)}" font-size="${num(t.fontSize)}" fill="${escapeXml(color)}" text-anchor="${anchor}">${out.join('')}</g>`;
}

function rectPath(el: Element, r: number): string {
  const rr = Math.max(0, Math.min(r, el.width / 2, el.height / 2));
  return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}"${rr ? ` rx="${num(rr)}" ry="${num(rr)}"` : ''}`;
}

function diamondPoints(el: Bounds): string {
  const c = center(el);
  return [
    [c.x, el.y],
    [el.x + el.width, c.y],
    [c.x, el.y + el.height],
    [el.x, c.y],
  ]
    .map(([x, y]) => `${num(x!)},${num(y!)}`)
    .join(' ');
}

function renderFlowNode(el: FlowNodeElement, ctx: Ctx): string {
  const info = getFlowNodePreset(el.preset);
  const paint = `fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}`;
  const { x, y, width: w, height: h } = el;
  let shape: string;
  switch (el.preset) {
    case 'decision':
      shape = `<polygon points="${diamondPoints(el)}" ${paint}/>`;
      break;
    case 'inputOutput': {
      const k = Math.min(w / 5, 24);
      shape = `<polygon points="${num(x + k)},${num(y)} ${num(x + w)},${num(y)} ${num(x + w - k)},${num(y + h)} ${num(x)},${num(y + h)}" ${paint}/>`;
      break;
    }
    case 'database': {
      const ry = Math.min(h / 6, 16);
      shape =
        `<path d="M ${num(x)} ${num(y + ry)} A ${num(w / 2)} ${num(ry)} 0 0 1 ${num(x + w)} ${num(y + ry)} L ${num(x + w)} ${num(y + h - ry)} ` +
        `A ${num(w / 2)} ${num(ry)} 0 0 1 ${num(x)} ${num(y + h - ry)} Z" ${paint}/>` +
        `<path d="M ${num(x)} ${num(y + ry)} A ${num(w / 2)} ${num(ry)} 0 0 0 ${num(x + w)} ${num(y + ry)}" fill="none"${strokeAttrs(el, ctx)}/>`;
      break;
    }
    case 'document': {
      const d = Math.min(h / 8, 12);
      shape =
        `<path d="M ${num(x)} ${num(y)} L ${num(x + w)} ${num(y)} L ${num(x + w)} ${num(y + h - d)} ` +
        `Q ${num(x + w * 0.75)} ${num(y + h - 2 * d)} ${num(x + w / 2)} ${num(y + h - d)} Q ${num(x + w * 0.25)} ${num(y + h)} ${num(x)} ${num(y + h - d)} Z" ${paint}/>`;
      break;
    }
    case 'annotation':
      shape =
        `<path d="M ${num(x + 12)} ${num(y)} L ${num(x)} ${num(y)} L ${num(x)} ${num(y + h)} L ${num(x + 12)} ${num(y + h)}" fill="none"${strokeAttrs(el, ctx)}/>`;
      break;
    default:
      shape = `${rectPath(el, el.style.cornerRadius || info.cornerRadius)} ${paint}/>`;
  }
  return shape + renderText(el, el, colorOf(el.style.stroke, ctx, 'text'), true, 4);
}

function renderFreehand(el: FreehandElement, ctx: Ctx): string {
  const color = colorOf(el.style.stroke, ctx);
  const pts = el.points;
  if (pts.length === 0) return '';
  const base = el.baseWidth;
  if (pts.length === 1) {
    const p = pts[0]!;
    return `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${num(pressureWidth(base, p.p) / 2)}" fill="${escapeXml(color)}"/>`;
  }
  // One round-capped segment per pair; width follows pressure (Req 9.4).
  const segs: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const w = (pressureWidth(base, a.p) + pressureWidth(base, b.p)) / 2;
    segs.push(`<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke-width="${num(w)}"/>`);
  }
  return `<g stroke="${escapeXml(color)}" stroke-linecap="round" stroke-linejoin="round" fill="none">${segs.join('')}</g>`;
}

function safeBase64(s: string): string {
  return s.replace(/[^A-Za-z0-9+/=]/g, '');
}

function renderImage(el: ImageElement, ctx: Ctx): string {
  const asset = ctx.assets.get(el.assetId);
  if (!asset) {
    return `${rectPath(el, 0)} fill="none" stroke="${escapeXml(ctx.palette.defaultStroke)}" stroke-dasharray="4 4"/>`;
  }
  const href = `data:${asset.mime};base64,${safeBase64(asset.data)}`;
  if (el.crop && el.crop.w > 0 && el.crop.h > 0) {
    const c = el.crop;
    return (
      `<svg x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}" viewBox="${num(c.x)} ${num(c.y)} ${num(c.w)} ${num(c.h)}" preserveAspectRatio="none" overflow="hidden">` +
      `<image href="${href}" x="0" y="0" width="${num(asset.width)}" height="${num(asset.height)}" preserveAspectRatio="none"/></svg>`
    );
  }
  return `<image href="${href}" x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}" preserveAspectRatio="none"/>`;
}

function headAt(kind: ArrowHead, tip: Point, from: Point, color: string, w: number): string {
  if (kind === 'none') return '';
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  const s = Math.max(10, w * 4);
  const px = -uy;
  const py = ux;
  const at = (back: number, side: number): string => `${num(tip.x - ux * back + px * side)},${num(tip.y - uy * back + py * side)}`;
  const c = escapeXml(color);
  switch (kind) {
    case 'arrow':
      return `<polyline points="${at(s, s / 2)} ${at(0, 0)} ${at(s, -s / 2)}" fill="none" stroke="${c}" stroke-width="${num(w)}" stroke-linejoin="round"/>`;
    case 'triangle':
      return `<polygon points="${at(0, 0)} ${at(s, s / 2)} ${at(s, -s / 2)}" fill="${c}" stroke="${c}"/>`;
    case 'diamond':
      return `<polygon points="${at(0, 0)} ${at(s / 2, s / 3)} ${at(s, 0)} ${at(s / 2, -s / 3)}" fill="${c}" stroke="${c}"/>`;
    case 'circle':
      return `<circle cx="${num(tip.x - ux * (s / 3))}" cy="${num(tip.y - uy * (s / 3))}" r="${num(s / 3)}" fill="${c}"/>`;
    case 'bar':
      return `<line x1="${at(0, s / 2).replace(',', '" y1="')}" x2="${at(0, -s / 2).replace(',', '" y2="')}" stroke="${c}" stroke-width="${num(w)}"/>`;
  }
}

function renderPolyline(el: Element, pts: readonly Point[], path: string | undefined, sa: ArrowHead, ta: ArrowHead, ctx: Ctx): string {
  const color = colorOf(el.style.stroke, ctx);
  const w = Math.max(el.style.strokeWidth, 1);
  const body = path
    ? `<path d="${escapeXml(path)}" fill="none"${strokeAttrs(el, ctx)}/>`
    : `<polyline points="${pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}" fill="none"${strokeAttrs(el, ctx)}/>`;
  const n = pts.length;
  if (n < 2) return body;
  const heads = headAt(ta, pts[n - 1]!, pts[n - 2]!, color, w) + headAt(sa, pts[0]!, pts[1]!, color, w);
  return body + heads;
}

function renderEdge(el: EdgeElement, ctx: Ctx): string {
  const route: EdgeRoute | undefined = routeEdgeElement(el, (id) => ctx.byId.get(id));
  if (!route) return '';
  let out = renderPolyline(el, route.points, route.path, el.sourceArrow, el.targetArrow, ctx);
  if (el.label) {
    const mid = route.points[Math.floor(route.points.length / 2)]!;
    const size = 14;
    const approxW = el.label.length * size * 0.6 + 8;
    const color = colorOf('theme:default', ctx, 'text');
    out +=
      `<rect x="${num(mid.x - approxW / 2)}" y="${num(mid.y - size / 2 - 3)}" width="${num(approxW)}" height="${num(size + 6)}" fill="${escapeXml(ctx.palette.background)}" stroke="none"/>` +
      renderText(
        { x: mid.x - approxW / 2, y: mid.y - size * 0.6 - 3 + 3, width: approxW, height: size + 6 },
        { runs: [{ text: el.label }], fontFamily: 'sans-serif', fontSize: size, align: 'center' },
        color,
        false,
      );
  }
  return out;
}

function renderElement(el: Element, ctx: Ctx): string {
  switch (el.type) {
    case 'rectangle':
      return wrap(el, `${rectPath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>`);
    case 'ellipse':
      return wrap(
        el,
        `<ellipse cx="${num(el.x + el.width / 2)}" cy="${num(el.y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}" fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>`,
      );
    case 'diamond':
      return wrap(el, `<polygon points="${diamondPoints(el)}" fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>`);
    case 'line':
    case 'arrow': {
      const pts = [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
      ];
      return wrap(el, renderPolyline(el, pts, undefined, 'none', el.type === 'arrow' ? 'arrow' : 'none', ctx));
    }
    case 'freehand':
      return wrap(el, renderFreehand(el, ctx));
    case 'text':
      return wrap(el, renderText(el, el, colorOf(el.style.stroke, ctx, 'text'), false));
    case 'sticky':
      return wrap(
        el,
        `${rectPath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` +
          renderText(el, el, colorOf(el.style.stroke, ctx, 'text'), false, 8),
      );
    case 'image':
      return wrap(el, renderImage(el, ctx));
    case 'frame':
      return wrap(
        el,
        `${rectPath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` +
          renderText(
            { x: el.x, y: el.y - 20, width: el.width, height: 18 },
            { runs: [{ text: el.name }], fontFamily: 'sans-serif', fontSize: 14, align: 'left' },
            colorOf(el.style.stroke, ctx, 'text'),
            false,
          ),
      );
    case 'flowNode':
      return wrap(el, renderFlowNode(el, ctx));
    case 'edge':
      return wrap(el, renderEdge(el, ctx));
  }
}

/** Renders a single element to an SVG fragment (the live canvas can use this per element). */
export function renderElementToSvg(
  el: Element,
  doc: Pick<BoardDocument, 'assets' | 'elements'>,
  palette: ThemePalette = builtinPalette('light'),
): string {
  return renderElement(el, makeCtx(doc, palette));
}

function makeCtx(doc: Pick<BoardDocument, 'assets' | 'elements'>, palette: ThemePalette): Ctx {
  return {
    palette,
    assets: new Map(doc.assets.map((a) => [a.id, a])),
    byId: new Map(doc.elements.map((e) => [e.id, e])),
  };
}

/**
 * Renders the scope (an ExportScope or an explicit element list) to a self-contained SVG string.
 * Fails with `empty-scope` when nothing is selected.
 */
export function renderToSvg(
  doc: Pick<BoardDocument, 'assets' | 'elements'>,
  scope: ExportScope | readonly Element[],
  options: RenderSvgOptions = {},
): ExportResult<SvgOutput> {
  const elements = Array.isArray(scope) ? [...(scope as readonly Element[])] : selectScope(doc, scope as ExportScope);
  const bounds = contentBounds(elements);
  if (!bounds) return { ok: false, error: EMPTY };

  const matchTheme = options.matchTheme === true;
  const bgMode = options.background ?? 'white';
  const themed = options.palette ?? builtinPalette('dark');
  // Without matchTheme: light default palette and white background (Req 4.8).
  // An explicit white background also uses the light palette so default colors stay legible.
  const palette = matchTheme && bgMode !== 'white' ? themed : builtinPalette('light');
  let bg: string | undefined;
  if (bgMode === 'transparent') bg = undefined;
  else if (bgMode === 'theme' && matchTheme) bg = palette.background;
  else bg = '#ffffff';

  const pad = Number.isFinite(options.padding) ? Math.max(0, options.padding as number) : 0;
  const ox = bounds.x - pad;
  const oy = bounds.y - pad;
  const width = Math.ceil(bounds.width + 2 * pad);
  const height = Math.ceil(bounds.height + 2 * pad);

  // Edges are resolved against the whole document so endpoints outside the scope still route.
  const ctx = makeCtx({ assets: doc.assets, elements: doc.elements }, palette);
  for (const e of elements) ctx.byId.set(e.id, ctx.byId.get(e.id) ?? e);

  const body = elements.map((e) => renderElement(e, ctx)).join('');
  const bgRect = bg ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(bg)}"/>` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    bgRect +
    `<g transform="translate(${num(-ox)} ${num(-oy)})">${body}</g></svg>`;
  return { ok: true, value: { svg, width, height, bounds } };
}
