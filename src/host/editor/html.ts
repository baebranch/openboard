/** Pure webview HTML builders (Req 16.1, 16.2). No vscode imports. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Cryptographically random nonce; `randomBytes` is injectable for tests. */
export function makeNonce(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(32);
  let out = '';
  for (const b of bytes) out += NONCE_CHARS[b % NONCE_CHARS.length];
  return out;
}

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/**
 * CSP: scripts only by nonce, no network (connect-src 'none'), no remote origins; images and
 * fonts only from the webview's own resource origin plus data:/blob: for embedded assets.
 */
export function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource}`,
    `connect-src 'none'`,
  ].join('; ');
}

export interface EditorHtmlInput {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  /** URI of dist/webview.css (from webview.asWebviewUri). */
  styleUri?: string;
  title?: string;
}

/** HTML shell that loads dist/webview.js and dist/webview.css. */
export function buildEditorHtml(i: EditorHtmlInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(buildCsp(i.cspSource, i.nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(i.title ?? 'OpenBoard')}</title>${i.styleUri ? `\n<link rel="stylesheet" href="${escapeHtml(i.styleUri)}">` : ''}
</head>
<body>
<div id="root"></div>
<script nonce="${i.nonce}" src="${escapeHtml(i.scriptUri)}"></script>
</body>
</html>`;
}

export interface InvalidHtmlInput {
  cspSource: string;
  nonce: string;
  message: string;
  /** Show the "Open as text" action (not offered for files declined for size). */
  offerOpenAsText: boolean;
}

/** Message the invalid-file panel posts when the user clicks "Open as text". */
export const OPEN_AS_TEXT_MESSAGE = { type: 'openAsText' } as const;

export function isOpenAsTextMessage(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const keys = Object.keys(raw);
  return keys.length === 1 && (raw as Record<string, unknown>)['type'] === OPEN_AS_TEXT_MESSAGE.type;
}

/** Error panel: an alert and an optional action, never a Canvas (Req 2.9, 11.7). */
export function buildInvalidHtml(i: InvalidHtmlInput): string {
  const csp = [`default-src 'none'`, `script-src 'nonce-${i.nonce}'`, `style-src 'unsafe-inline'`, `connect-src 'none'`].join('; ');
  const action = i.offerOpenAsText ? `<button id="open-as-text" type="button">Open as text</button>` : '';
  const script = i.offerOpenAsText
    ? `<script nonce="${i.nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('open-as-text').addEventListener('click', () => vscode.postMessage({ type: 'openAsText' }));
</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<title>Invalid board file</title>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
h1 { font-size: 1.2em; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
</style>
</head>
<body>
<div role="alert">
<h1>This board cannot be opened</h1>
<p>${escapeHtml(i.message)}</p>
<p>The file on disk has not been modified.</p>
${action}
</div>
${script}
</body>
</html>`;
}
