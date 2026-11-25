/**
 * Shared pure SVG renderer used for both canvas and export (Req 12.3, 12.7, 12.14, 4.8).
 * No DOM or vscode imports. The output is self-contained: assets are inlined as data URIs and
 * nothing references an external resource (the only URL is the SVG namespace declaration).
 */
import { getFlowNodePreset } from '../flow/presets';
import { routeEdgeElement, type EdgeRoute } from '../flow/routing';
import { pressureWidth } from '../freehand';
import { ICON_PATHS, PLACEHOLDER_ICON_PATH, isKnownIcon } from '../icons';
import { fitImage } from '../image/fit';
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
import { measure } from '../text/measure';
import { resolveMode, resolveTokens, resolveTokenValue } from '../tokens/resolve';
import type { ResolvedTokens, TokenMode } from '../tokens/types';
import { isTokenReference } from '../tokens/validate';
import { builtinPalette, contrastRatio, parseColor, pickContrastColor, resolveElementColor, type ThemePalette } from '../theme';
import { backdropCandidates } from './backdrop';
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
  /** Token mode for the export (Req 12.5): `light`, `dark`, or `active` (the board's mode). Default `active`. */
  tokenMode?: 'light' | 'dark' | 'active';
  /** Output region in board coordinates; content outside it is cut off. Default: the content bounds. */
  crop?: Bounds;
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
  /** Elements in stacking order (bottom first), for finding what sits behind text. */
  order: readonly Element[];
  /** Collected <clipPath> definitions for clipping Frames, keyed by frame id (insertion order). */
  clipDefs: Map<string, string>;
  /** Resolved design tokens; absent when the document has none. */
  tokens?: ResolvedTokens;
}

const DEFAULT_FONT_FAMILY = 'sans-serif';

/** Resolves a Token_Reference to its literal; a missing token yields undefined (the field default applies). */
function resolveToken(value: string, category: 'colors' | 'fonts', ctx: Ctx): string | undefined {
  if (!isTokenReference(value)) return value;
  return ctx.tokens ? resolveTokenValue(ctx.tokens, category, value) : undefined;
}

function fontOf(value: string, ctx: Ctx | undefined): string {
  if (!ctx || !isTokenReference(value)) return value;
  return resolveToken(value, 'fonts', ctx) ?? DEFAULT_FONT_FAMILY;
}

function colorOf(raw: string, ctx: Ctx, role: 'stroke' | 'text' = 'stroke'): string {
  const value = resolveToken(raw, 'colors', ctx) ?? 'theme:default';
  const c = resolveElementColor(value, ctx.palette, role);
  return parseColor(c) ? c : ctx.palette.defaultStroke;
}

function fillOf(el: Element, ctx: Ctx): string {
  const fill = resolveToken(el.style.fill, 'colors', ctx) ?? 'theme:default';
  if (fill === 'theme:default') return el.type === 'sticky' ? '#fff59d' : 'none';
  return colorOf(fill, ctx);
}

/** Opaque fill an element paints, or undefined when it paints none (or a translucent / unparseable one). */
function opaqueFillOf(el: Element, ctx: Ctx): string | undefined {
  if (el.type === 'text' || el.type === 'image' || el.type === 'edge') return undefined;
  const f = fillOf(el, ctx);
  if (f === 'none') return undefined;
  const parsed = parseColor(f);
  return parsed && parsed.a >= 1 ? f : undefined;
}

/**
 * The opaque color directly behind `el`'s text: its own fill (when `includeSelf`), else the topmost
 * filled shape or Frame beneath the text, else undefined (the text sits on the canvas).
 */
function backdropOf(el: Element, ctx: Ctx, includeSelf: boolean): string | undefined {
  if (includeSelf) {
    const own = opaqueFillOf(el, ctx);
    if (own !== undefined) return own;
  }
  for (const c of backdropCandidates(el, ctx.order, ctx.byId)) {
    const fill = opaqueFillOf(c, ctx);
    if (fill !== undefined) return fill;
  }
  return undefined;
}

/**
 * Below this ratio an explicit text color directly on the canvas counts as unreadable (WCAG's
 * minimum for large text), and is replaced by black or white for the current canvas.
 */
const CANVAS_TEXT_MIN_RATIO = 3;

/**
 * Text color that is legible on what actually sits behind the text.
 * - The theme default is checked against the backdrop (own fill, a filled shape or Frame beneath,
 *   or the canvas) and flips to black or white when it would not reach 4.5:1.
 * - An explicit color on a filled backdrop is used as authored (that pairing is a design choice).
 * - An explicit color directly on the canvas follows the canvas: the canvas changes with the theme
 *   (light or dark), so a color below 3:1 against it is replaced by black or white.
 */
function textColorOf(el: Element, raw: string, ctx: Ctx, includeSelf: boolean): string {
  const value = resolveToken(raw, 'colors', ctx) ?? 'theme:default';
  const color = colorOf(raw, ctx, 'text');
  const backdrop = backdropOf(el, ctx, includeSelf);
  if (value === 'theme:default') return pickContrastColor(backdrop ?? ctx.palette.background, [color]);
  if (backdrop !== undefined) return color;
  const ratio = contrastRatio(color, ctx.palette.background);
  return Number.isNaN(ratio) || ratio >= CANVAS_TEXT_MIN_RATIO ? color : pickContrastColor(ctx.palette.background, [ctx.palette.defaultText]);
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

/** Re-slice one explicit-newline paragraph of runs at the measurer's break offsets, preserving run styling. */
function wrapParagraph(
  para: readonly TextRun[],
  t: { fontFamily: string; fontSize: number; fontWeight?: number },
  width: number,
): TextRun[][] {
  const chars: { ch: string; run: TextRun }[] = [];
  for (const run of para) for (const ch of Array.from(run.text)) chars.push({ ch, run });
  const text = chars.map((c) => c.ch).join('');
  const out = measure({ text, fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: t.fontWeight, availableWidth: width });
  if (!out.ok) return [[...para]];
  const lines: TextRun[][] = [];
  let p = 0;
  for (const line of out.value.lines) {
    const pieces: { ch: string; run: TextRun }[] = [];
    for (const lc of Array.from(line)) {
      while (p < chars.length && /\s/.test(chars[p]!.ch) && lc !== ' ') p++;
      if (p >= chars.length) break;
      const src = chars[p]!;
      pieces.push({ ch: lc, run: src.run });
      if (lc === ' ') {
        while (p < chars.length && /\s/.test(chars[p]!.ch)) p++;
      } else p++;
    }
    const runs: TextRun[] = [];
    let last: TextRun | undefined;
    for (const pc of pieces) {
      if (last === pc.run) runs[runs.length - 1]!.text += pc.ch;
      else {
        runs.push({ ...pc.run, text: pc.ch });
        last = pc.run;
      }
    }
    lines.push(runs);
  }
  return lines.length ? lines : [[]];
}

function renderText(
  box: Bounds,
  t: {
    runs: TextRun[];
    fontFamily: string;
    fontSize: number;
    align: TextAlign;
    fontWeight?: number;
    textWrap?: 'none' | 'wrap';
  },
  color: string,
  vcenter: boolean,
  pad = 0,
  ctx?: Ctx,
): string {
  const fontFamily = fontOf(t.fontFamily, ctx);
  let lines = textLines(t.runs);
  if (t.textWrap === 'wrap') {
    const w = box.width - 2 * pad;
    lines = lines.flatMap((para) => wrapParagraph(para, { ...t, fontFamily }, w));
  }
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
        if (r.bold) a.push(t.fontWeight === undefined ? 'font-weight="bold"' : `font-weight="${Math.max(700, t.fontWeight)}"`);
        if (r.italic) a.push('font-style="italic"');
        if (r.underline) a.push('text-decoration="underline"');
        return `<tspan${a.length ? ' ' + a.join(' ') : ''}>${escapeXml(r.text)}</tspan>`;
      })
      .join('');
    return `<text x="${num(x)}" y="${num(y)}" xml:space="preserve">${spans}</text>`;
  });
  return `<g font-family="${escapeXml(fontFamily)}" font-size="${num(t.fontSize)}"${t.fontWeight === undefined ? '' : ` font-weight="${t.fontWeight}"`} fill="${escapeXml(color)}" text-anchor="${anchor}">${out.join('')}</g>`;
}

function rectPath(el: Element, r: number): string {
  const rr = Math.max(0, Math.min(r, el.width / 2, el.height / 2));
  return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}"${rr ? ` rx="${num(rr)}" ry="${num(rr)}"` : ''}`;
}

/** Closed path with per-corner radii (TL, TR, BR, BL); 0 yields a square corner. Returns an unterminated `<path` tag like rectPath. */
export function cornerPath(el: Bounds, radii: readonly [number, number, number, number]): string {
  const { x, y, width: w, height: h } = el;
  let r = radii.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  // Scale down uniformly when adjacent radii would overlap along a side.
  const [a, b, c, d] = r as [number, number, number, number];
  const f = Math.min(
    1,
    a + b > 0 ? w / (a + b) : 1,
    d + c > 0 ? w / (d + c) : 1,
    a + d > 0 ? h / (a + d) : 1,
    b + c > 0 ? h / (b + c) : 1,
  );
  r = r.map((v) => v * f);
  const [tl, tr, br, bl] = r as [number, number, number, number];
  const arc = (rad: number, ex: number, ey: number) => (rad > 0 ? ` A ${num(rad)} ${num(rad)} 0 0 1 ${num(ex)} ${num(ey)}` : '');
  const d_ =
    `M ${num(x + tl)} ${num(y)} L ${num(x + w - tr)} ${num(y)}` +
    (tr > 0 ? arc(tr, x + w, y + tr) : ` L ${num(x + w)} ${num(y)}`) +
    ` L ${num(x + w)} ${num(y + h - br)}` +
    (br > 0 ? arc(br, x + w - br, y + h) : ` L ${num(x + w)} ${num(y + h)}`) +
    ` L ${num(x + bl)} ${num(y + h)}` +
    (bl > 0 ? arc(bl, x, y + h - bl) : ` L ${num(x)} ${num(y + h)}`) +
    ` L ${num(x)} ${num(y + tl)}` +
    (tl > 0 ? arc(tl, x + tl, y) : ` L ${num(x)} ${num(y)}`) +
    ' Z';
  return `<path d="${d_}"`;
}

/** Uses cornerPath when style.cornerRadii is present, otherwise the byte-stable rectPath. */
function shapePath(el: Element, r: number): string {
  const radii = el.style.cornerRadii;
  return radii ? cornerPath(el, radii) : rectPath(el, r);
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

/** Unterminated outline tag (no stroke/fill attrs) matching the element's exact shape, for clipping and stroke overlay. */
function outlineTag(el: Element): string {
  switch (el.type) {
    case 'ellipse':
      return `<ellipse cx="${num(el.x + el.width / 2)}" cy="${num(el.y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}"`;
    case 'diamond':
      return `<polygon points="${diamondPoints(el)}"`;
    case 'flowNode': {
      if (el.preset === 'decision') return `<polygon points="${diamondPoints(el)}"`;
      if (el.preset === 'inputOutput') {
        const k = Math.min(el.width / 5, 24);
        const { x, y, width: w, height: h } = el;
        return `<polygon points="${num(x + k)},${num(y)} ${num(x + w)},${num(y)} ${num(x + w - k)},${num(y + h)} ${num(x)},${num(y + h)}"`;
      }
      return shapePath(el, el.style.cornerRadius || getFlowNodePreset(el.preset).cornerRadius);
    }
    default:
      return shapePath(el, el.style.cornerRadius);
  }
}

/**
 * Image fill layer: the image clipped to the element outline, then the outline stroke redrawn on top.
 * Returns '' (silent fallback to the flat fill) when there is no imageFill or the asset is missing/undecodable.
 */
function imageFillLayer(el: Element, ctx: Ctx): string {
  const f = el.style.imageFill;
  if (!f) return '';
  const asset = ctx.assets.get(f.assetId);
  if (!asset || !/^image\/[a-z0-9.+-]+$/i.test(asset.mime) || !(asset.width > 0) || !(asset.height > 0) || !asset.data) return '';
  const r = fitImage(asset.width, asset.height, el, f.fit);
  const href = `data:${asset.mime};base64,${safeBase64(asset.data)}`;
  const id = `clip-${escapeXml(el.id)}`;
  const outline = outlineTag(el);
  return (
    `<clipPath id="${id}">${outline}/></clipPath>` +
    `<image href="${href}" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.width)}" height="${num(r.height)}" preserveAspectRatio="none" clip-path="url(#${id})"/>` +
    `${outline} fill="none"${strokeAttrs(el, ctx)}/>`
  );
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
      shape = `${shapePath(el, el.style.cornerRadius || info.cornerRadius)} ${paint}/>`;
  }
  return shape + imageFillLayer(el, ctx) + renderText(el, el, textColorOf(el, el.textColor ?? el.style.stroke, ctx, true), true, 4, ctx);
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
    return `${shapePath(el, 0)} fill="none" stroke="${escapeXml(ctx.palette.defaultStroke)}" stroke-dasharray="4 4"/>`;
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

function renderElementBase(el: Element, ctx: Ctx): string {
  switch (el.type) {
    case 'rectangle':
      return wrap(
        el,
        `${shapePath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` + imageFillLayer(el, ctx),
      );
    case 'ellipse':
      return wrap(
        el,
        `<ellipse cx="${num(el.x + el.width / 2)}" cy="${num(el.y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}" fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` +
          imageFillLayer(el, ctx),
      );
    case 'diamond':
      return wrap(
        el,
        `<polygon points="${diamondPoints(el)}" fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` + imageFillLayer(el, ctx),
      );
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
      return wrap(el, renderText(el, el, textColorOf(el, el.textColor ?? el.style.stroke, ctx, false), false, 0, ctx));
    case 'sticky':
      return wrap(
        el,
        `${shapePath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` +
          imageFillLayer(el, ctx) +
          renderText(el, el, textColorOf(el, el.textColor ?? el.style.stroke, ctx, true), false, 8, ctx),
      );
    case 'image':
      return wrap(el, renderImage(el, ctx));
    case 'frame':
      return wrap(
        el,
        `${shapePath(el, el.style.cornerRadius)} fill="${escapeXml(fillOf(el, ctx))}"${strokeAttrs(el, ctx)}/>` +
          imageFillLayer(el, ctx) +
          // Instances and their derived child Frames omit the name label: it repeats the master's
          // and clutters repeated components. The name stays in the Properties_Panel.
          (el.instanceOf !== undefined || el.id.includes('::')
            ? ''
            : renderText(
                { x: el.x, y: el.y - 20, width: el.width, height: 18 },
                { runs: [{ text: el.name }], fontFamily: 'sans-serif', fontSize: 14, align: 'left' },
                textColorOf(el, el.style.stroke, ctx, false),
                false,
              )),
      );
    case 'flowNode':
      return wrap(el, renderFlowNode(el, ctx));
    case 'edge':
      return wrap(el, renderEdge(el, ctx));
    case 'icon': {
      // 24-unit Icon_Set path scaled to the element box; the stroke keeps its screen width.
      const d = isKnownIcon(el.name) ? ICON_PATHS[el.name]! : PLACEHOLDER_ICON_PATH;
      const sx = el.width / 24;
      const sy = el.height / 24;
      return wrap(
        el,
        `<path d="${escapeXml(d)}" transform="translate(${num(el.x)} ${num(el.y)}) scale(${num(sx)} ${num(sy)})" fill="none"${strokeAttrs(el, ctx)}${el.style.strokeStyle === 'dotted' ? '' : ' stroke-linecap="round"'} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
      );
    }
  }
}

/** Nearest ancestor Frame with clipContent, or undefined. Cycle-safe. */
function clipAncestor(el: Element, ctx: Ctx): Element | undefined {
  const seen = new Set<string>([el.id]);
  let pid = el.parentId;
  while (pid !== undefined && !seen.has(pid)) {
    seen.add(pid);
    const p = ctx.byId.get(pid);
    if (!p) return undefined;
    if (p.type === 'frame' && (p.clipContent === true || masterOf(p, ctx)?.clipContent === true)) return p;
    pid = p.parentId;
  }
  return undefined;
}

/** The Component_Master frame a Component_Instance links to, or undefined for any other element. */
function masterOf(el: Element, ctx: Ctx): (Element & { type: 'frame' }) | undefined {
  if (el.type !== 'frame' || el.instanceOf === undefined) return undefined;
  const m = ctx.byId.get(el.instanceOf);
  return m && m.type === 'frame' && m.component !== undefined ? m : undefined;
}

/**
 * Shape a clipping Frame cuts to. A Component_Instance whose own style has no corner radii takes its master's
 * (Req 24.8: a Device_Frame_Preset clips to the device screen shape); stored geometry is never changed.
 */
function clipShape(frame: Element, ctx: Ctx): Element {
  const m = masterOf(frame, ctx);
  if (!m || frame.style.cornerRadii || !m.style.cornerRadii) return frame;
  return { ...frame, style: { ...frame.style, cornerRadius: m.style.cornerRadius, cornerRadii: m.style.cornerRadii } };
}

/**
 * Registers the clipPath for a clipping Frame and returns its id. The definition references the frame's own
 * nearest clipping ancestor via `clip-path`, so nested clips compose as an intersection.
 * Verified in Chromium (the real rasterizer engine) by clip-raster.test.ts, so no per-level `<g clip-path>` is needed.
 */
function defineClip(frame: Element, ctx: Ctx): string {
  const id = `clipc-${escapeXml(frame.id)}`;
  if (ctx.clipDefs.has(frame.id)) return id;
  ctx.clipDefs.set(frame.id, ''); // reserve first so a malformed cycle cannot recurse forever
  const parent = clipAncestor(frame, ctx);
  const nested = parent ? ` clip-path="url(#${defineClip(parent, ctx)})"` : '';
  const c = center(frame);
  const rot = frame.rotation ? ` transform="rotate(${num(frame.rotation)} ${num(c.x)} ${num(c.y)})"` : '';
  ctx.clipDefs.set(frame.id, `<clipPath id="${id}"${nested}>${outlineTag(clipShape(frame, ctx))}${rot}/></clipPath>`);
  return id;
}

/** Renders an element wrapped in its nearest clipping ancestor's clip-path. Edges are never clipped. */
function renderElement(el: Element, ctx: Ctx): string {
  const inner = renderElementBase(el, ctx);
  if (el.type === 'edge') return inner;
  const anc = clipAncestor(el, ctx);
  if (!anc) return inner;
  return `<g clip-path="url(#${defineClip(anc, ctx)})">${inner}</g>`;
}

/** Renders a single element to an SVG fragment (the live canvas can use this per element). */
export function renderElementToSvg(
  el: Element,
  doc: Pick<BoardDocument, 'assets' | 'elements' | 'tokens'> & Partial<Pick<BoardDocument, 'settings'>>,
  palette: ThemePalette = builtinPalette('light'),
): string {
  const ctx = makeCtx(doc, palette);
  const out = renderElement(el, ctx);
  return [...ctx.clipDefs.values()].join('') + out;
}

function makeCtx(
  doc: Pick<BoardDocument, 'assets' | 'elements' | 'tokens'> & Partial<Pick<BoardDocument, 'settings'>>,
  palette: ThemePalette,
  modeOverride?: TokenMode,
): Ctx {
  return {
    ...(doc.tokens ? { tokens: resolveTokens(doc.tokens, modeOverride ?? resolveMode(doc.settings?.activeMode, palette.kind)) } : {}),
    palette,
    assets: new Map(doc.assets.map((a) => [a.id, a])),
    byId: new Map(doc.elements.map((e) => [e.id, e])),
    order: doc.elements,
    clipDefs: new Map(),
  };
}

/**
 * Renders the scope (an ExportScope or an explicit element list) to a self-contained SVG string.
 * Fails with `empty-scope` when nothing is selected.
 */
export function renderToSvg(
  doc: Pick<BoardDocument, 'assets' | 'elements' | 'tokens'> & Partial<Pick<BoardDocument, 'settings'>>,
  scope: ExportScope | readonly Element[],
  options: RenderSvgOptions = {},
): ExportResult<SvgOutput> {
  const elements = Array.isArray(scope) ? [...(scope as readonly Element[])] : selectScope(doc, scope as ExportScope);
  const content = contentBounds(elements);
  if (!content) return { ok: false, error: EMPTY };
  const crop = options.crop;
  const bounds = crop && crop.width > 0 && crop.height > 0 ? crop : content;

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
  const modeOverride = options.tokenMode === 'light' || options.tokenMode === 'dark' ? options.tokenMode : undefined;
  const ctx = makeCtx(
    { assets: doc.assets, elements: doc.elements, tokens: doc.tokens, ...(doc.settings ? { settings: doc.settings } : {}) },
    palette,
    modeOverride,
  );
  for (const e of elements) ctx.byId.set(e.id, ctx.byId.get(e.id) ?? e);

  const body = elements.map((e) => renderElement(e, ctx)).join('');
  const defs = ctx.clipDefs.size ? `<defs>${[...ctx.clipDefs.values()].join('')}</defs>` : '';
  const bgRect = bg ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(bg)}"/>` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    bgRect +
    defs +
    `<g transform="translate(${num(-ox)} ${num(-oy)})">${body}</g></svg>`;
  return { ok: true, value: { svg, width, height, bounds } };
}
