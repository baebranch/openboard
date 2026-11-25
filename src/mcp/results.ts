/** Maps registry results to MCP tool results. Pure. */

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  [key: string]: unknown;
}

function isImageItem(v: unknown): v is { mimeType: string; data: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { mimeType?: unknown; data?: unknown };
  return typeof o.mimeType === 'string' && o.mimeType.startsWith('image/') && typeof o.data === 'string' && o.data.length > 0;
}

export function errorResult(code: string, message: string): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }], isError: true };
}

/** True when a registry result is the `{ error: { code, message } }` shape. */
export function registryError(result: unknown): { code: string; message: string } | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const e = (result as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return undefined;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return { code: typeof code === 'string' ? code : 'error', message: typeof message === 'string' ? message : '' };
}

/** JSON text content plus MCP image content for base64 image data (top level or in `results[]`). */
export function mapResult(result: unknown): McpToolResult {
  const images: McpContent[] = [];
  let shaped = result;
  const strip = (item: unknown): unknown => {
    if (!isImageItem(item)) return item;
    images.push({ type: 'image', data: item.data, mimeType: item.mimeType });
    return { ...item, data: '[image data returned as an image content part]' };
  };
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (isImageItem(r)) shaped = strip(r);
    else if (Array.isArray(r.results)) shaped = { ...r, results: r.results.map(strip) };
  }
  const text = JSON.stringify(shaped === undefined ? null : shaped);
  const content: McpContent[] = [{ type: 'text', text }, ...images];
  return registryError(result) ? { content, isError: true } : { content };
}
