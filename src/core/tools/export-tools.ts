/**
 * `openboard.export` and `openboard.board.preview` (Req 12.1, 12.2, 13.14, 13.15).
 * The core cannot rasterize or write files; both are injected through `ExportHost`.
 * Both tools are `async` board tools: they read the resolved model without a transaction.
 */
import { serialize } from '../format/serializer';
import { intersects, rotatedBounds } from '../model/geometry';
import type { BoardDocument, Element } from '../model/types';
import {
  EXPORT_FORMATS,
  prepareExport,
  renderToSvg,
  selectFrameScopes,
  writePdf,
  type ExportFormat,
  type ExportOptions,
  type ExportScope,
} from '../export';
import { embedDocument } from '../export/png-chunk';
import { s } from '../schema/builder';
import type { DefaultToolRegistry, ToolDefinition } from './registry';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export interface RasterizeOptions {
  format: RasterFormat;
  scale: number;
  /** SVG size in user units. */
  width: number;
  height: number;
  background: 'transparent' | 'white' | 'theme';
}

/** Host services the core cannot provide itself. */
export interface ExportHost {
  rasterize(svg: string, options: RasterizeOptions): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const toBase64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

interface Rendered {
  bytes: Uint8Array;
  width: number;
  height: number;
}

async function renderOne(
  host: ExportHost,
  doc: BoardDocument,
  opts: ExportOptions,
  prepared: { elements: Element[] },
): Promise<Rendered> {
  const svgRes = renderToSvg(doc, prepared.elements, {
    padding: opts.padding,
    background: opts.background,
    matchTheme: opts.matchTheme,
  });
  if (!svgRes.ok) throw new ToolFailure(svgRes.error.code, svgRes.error.message);
  const { svg, width, height } = svgRes.value;
  const enc = new TextEncoder();
  switch (opts.format) {
    case 'svg':
      return { bytes: enc.encode(svg), width, height };
    case 'pdf': {
      const jpeg = await host.rasterize(svg, { format: 'jpeg', scale: 1, width, height, background: opts.background });
      return { bytes: writePdf([{ width, height, pixelWidth: width, pixelHeight: height, jpeg }]), width, height };
    }
    default: {
      let bytes = await host.rasterize(svg, {
        format: opts.format,
        scale: opts.scale,
        width,
        height,
        background: opts.background,
      });
      if (opts.format === 'png' && opts.embedBoard) bytes = embedDocument(bytes, serialize(doc));
      return { bytes, width: Math.ceil(width * opts.scale), height: Math.ceil(height * opts.scale) };
    }
  }
}

function suffixPath(path: string, index: number): string {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const n = String(index + 1);
  return dot > slash + 1 ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
}

interface ExportInput {
  board?: string;
  format?: ExportFormat;
  scope?: 'board' | 'selection' | 'frame' | 'allFrames';
  ids?: string[];
  frameId?: string;
  scale?: 1 | 2 | 3 | 4;
  padding?: number;
  background?: 'transparent' | 'white' | 'theme';
  matchTheme?: boolean;
  embedBoard?: boolean;
  path?: string;
}

interface ExportResultItem {
  mimeType: string;
  width: number;
  height: number;
  frameId?: string;
  data?: string;
  path?: string;
}

const resultItemSchema = s.object({
  mimeType: s.string(),
  width: s.number(),
  height: s.number(),
  frameId: s.opt(s.string()),
  data: s.opt(s.string()),
  path: s.opt(s.string()),
});

function exportTool(host: ExportHost): ToolDefinition<ExportInput, { results: ExportResultItem[] }> {
  return {
    name: 'openboard.export',
    description:
      'Export the board, a selection (`ids`), a frame (`frameId`), or every frame (`scope`: board | selection | frame | allFrames) as png, svg, jpeg, webp, or pdf. Options: `scale` 1 to 4, `padding` 0 to 256, `background`, `matchTheme`, `embedBoard` (PNG only). With `path` the files are written there (allFrames adds -1, -2 suffixes) and the result lists paths; otherwise base64 `data` and `mimeType` are returned. allFrames returns one result per Frame.',
    inputSchema: s.object({
      board: s.opt(s.string({ minLength: 1 })),
      format: s.opt(s.enum(EXPORT_FORMATS)),
      scope: s.opt(s.enum(['board', 'selection', 'frame', 'allFrames'])),
      ids: s.opt(s.array(s.string(), { minItems: 1 })),
      frameId: s.opt(s.string({ minLength: 1 })),
      scale: s.opt(s.enum([1, 2, 3, 4])),
      padding: s.opt(s.number()),
      background: s.opt(s.enum(['transparent', 'white', 'theme'])),
      matchTheme: s.opt(s.boolean()),
      embedBoard: s.opt(s.boolean()),
      path: s.opt(s.string({ minLength: 1 })),
    }),
    outputSchema: s.object({ results: s.array(resultItemSchema) }),
    writesElsewhere: true,
    boardResolution: 'required-or-active',
    async: true,
    async handler(ctx, input) {
      if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
      const doc = ctx.model.getDocument();
      const kind = input.scope ?? 'board';
      let scope: ExportScope;
      if (kind === 'selection') {
        if (!input.ids) throw new ToolFailure('invalid_input', 'scope "selection" requires `ids`');
        scope = { kind, ids: input.ids };
      } else if (kind === 'frame') {
        if (!input.frameId) throw new ToolFailure('invalid_input', 'scope "frame" requires `frameId`');
        scope = { kind, id: input.frameId };
      } else scope = { kind };
      const opts: ExportOptions = {
        format: input.format ?? 'png',
        scope,
        scale: input.scale ?? 1,
        padding: input.padding ?? 0,
        background: input.background ?? 'white',
        matchTheme: input.matchTheme ?? false,
        ...(input.embedBoard !== undefined ? { embedBoard: input.embedBoard } : {}),
      };

      const regions: { frameId?: string; opts: ExportOptions }[] = [];
      const first = prepareExport(doc, opts);
      if (!first.ok) throw new ToolFailure(first.error.code, first.error.message);
      if (kind === 'allFrames') {
        for (const { frame } of selectFrameScopes(doc)) {
          regions.push({ frameId: frame.id, opts: { ...opts, scope: { kind: 'frame', id: frame.id } } });
        }
      } else regions.push({ opts });

      const results: ExportResultItem[] = [];
      for (const [i, r] of regions.entries()) {
        const prep = prepareExport(doc, r.opts);
        if (!prep.ok) throw new ToolFailure(prep.error.code, prep.error.message);
        const out = await renderOne(host, doc, r.opts, prep.value);
        const item: ExportResultItem = { mimeType: MIME[opts.format], width: out.width, height: out.height };
        if (r.frameId !== undefined) item.frameId = r.frameId;
        if (input.path !== undefined) {
          const target = kind === 'allFrames' ? suffixPath(input.path, i) : input.path;
          await host.writeFile(target, out.bytes);
          item.path = target;
        } else item.data = toBase64(out.bytes);
        results.push(item);
      }
      return { results };
    },
  };
}

interface PreviewInput {
  board?: string;
  region?: { x: number; y: number; width: number; height: number };
  scale?: 1 | 2 | 3 | 4;
  padding?: number;
}

function previewTool(host: ExportHost): ToolDefinition<PreviewInput, { mimeType: string; data: string; width: number; height: number }> {
  return {
    name: 'openboard.board.preview',
    description:
      'Render a PNG preview of the whole board or of a `region` ({x, y, width, height} in board coordinates; elements intersecting it are drawn). Returns base64 PNG `data` with `mimeType`. Read-only.',
    inputSchema: s.object({
      board: s.opt(s.string({ minLength: 1 })),
      region: s.opt(
        s.object({ x: s.number(), y: s.number(), width: s.number({ min: 0 }), height: s.number({ min: 0 }) }),
      ),
      scale: s.opt(s.enum([1, 2, 3, 4])),
      padding: s.opt(s.number()),
    }),
    outputSchema: s.object({ mimeType: s.string(), data: s.string(), width: s.number(), height: s.number() }),
    readOnly: true,
    boardResolution: 'required-or-active',
    async: true,
    async handler(ctx, input) {
      if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
      const doc = ctx.model.getDocument();
      let scope: ExportScope = { kind: 'board' };
      if (input.region) {
        const region = input.region;
        const ids = doc.elements.filter((e) => intersects(rotatedBounds(e), region)).map((e) => e.id);
        scope = { kind: 'selection', ids };
      }
      const opts: ExportOptions = {
        format: 'png',
        scope,
        scale: input.scale ?? 1,
        padding: input.padding ?? 0,
        background: 'white',
        matchTheme: false,
      };
      const prep = prepareExport(doc, opts);
      if (!prep.ok) throw new ToolFailure(prep.error.code, prep.error.message);
      const out = await renderOne(host, doc, opts, prep.value);
      return { mimeType: MIME.png, data: toBase64(out.bytes), width: out.width, height: out.height };
    },
  };
}

export function exportTools(host: ExportHost): ToolDefinition[] {
  return [exportTool(host), previewTool(host)];
}

export function registerExportTools(registry: Pick<DefaultToolRegistry, 'register'>, host: ExportHost): void {
  for (const t of exportTools(host)) registry.register(t);
}
