import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { createEmptyDocument, parse } from '../../core/format/parser';
import { buildBoardSchema } from '../../core/schema/board';
import { buildMessageSchemas } from '../../core/schema/messages';
import { createMessageValidation, type HostToWebview, type MessageValidators } from '../../shared/messages';
import type { Settings } from '../../core/settings/settings';
import { buildCsp, buildEditorHtml, buildInvalidHtml, isOpenAsTextMessage, makeNonce } from './html';
import {
  MAX_BOARD_FILE_BYTES,
  describeInvalid,
  loadBoard,
  loadFromBytes,
  type LoaderFs,
} from './loader';
import { NOTICE_LARGE_BOARD, SessionHub, routeMessage, type Session } from './session';
import { BoardDocumentState, type EditEvent } from './state';

const ajv = new Ajv({ strict: false, discriminator: true });
const schemas = buildMessageSchemas();
const validators = {
  validateWebviewToHost: ajv.compile(schemas['validateWebviewToHost']!),
  validateHostToWebview: ajv.compile(schemas['validateHostToWebview']!),
} as MessageValidators;
const validateBoard = ajv.compile(buildBoardSchema());
const parseText = (t: string) => parse(t, { validator: validateBoard });
const bytes = (s: string) => new TextEncoder().encode(s);

const settings: Settings = {
  defaultExportScale: 2,
  defaultExportBackground: 'theme',
  gridSpacing: 20,
  defaultFontFamily: 'sans-serif',
  autoLayoutDirection: 'horizontal',
};

function memFs(size: number, content = ''): LoaderFs<string> & { reads: number } {
  const fs = {
    reads: 0,
    stat: async () => ({ size }),
    readFile: async () => {
      fs.reads++;
      return bytes(content);
    },
  };
  return fs;
}

function loaded(): BoardDocumentState {
  const out = loadFromBytes(bytes(''), parseText);
  return new BoardDocumentState('mem', out);
}

const rect = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, locked: false, style: {} } as never;

describe('loader', () => {
  it('declines files over 200 MB without reading them', async () => {
    const fs = memFs(MAX_BOARD_FILE_BYTES + 1);
    const r = await loadBoard(fs, 'f', parseText);
    expect(r.ok).toBe(false);
    expect(fs.reads).toBe(0);
    if (!r.ok) expect(describeInvalid(r.reason)).toMatch(/200 MB/);
  });

  it('accepts exactly 200 MB and treats empty content as an empty board', async () => {
    const r = await loadBoard(memFs(MAX_BOARD_FILE_BYTES, ''), 'f', parseText);
    expect(r.ok && r.doc.elements).toEqual([]);
  });

  it('reports JSON and schema errors', () => {
    const j = loadFromBytes(bytes('{ nope'), parseText);
    expect(!j.ok && j.reason.kind).toBe('json');
    const s = loadFromBytes(bytes('{"schemaVersion":1}'), parseText);
    expect(!s.ok && s.reason.kind).toBe('schema');
  });

  it('opens newer schema versions read-only with raw text', () => {
    const raw = JSON.stringify({ schemaVersion: 9999, whatever: true });
    const r = loadFromBytes(bytes(raw), parseText);
    expect(r.ok && r.readOnly).toBe(true);
    expect(r.ok && r.rawText).toBe(raw);
  });
});

describe('BoardDocumentState', () => {
  it('fires edit events whose undo/redo drive UndoHistory', () => {
    const s = loaded();
    const events: EditEvent[] = [];
    s.onDidEdit((e) => events.push(e));
    s.model!.transact('add', (tx) => void tx.create(rect));
    expect(events).toHaveLength(1);
    expect(s.elementCount()).toBe(1);
    events[0]!.undo();
    expect(s.elementCount()).toBe(0);
    events[0]!.redo();
    expect(s.elementCount()).toBe(1);
    expect(events).toHaveLength(1); // undo/redo do not create new dirty events
  });

  it('serializes content and reset clears history and notifies', () => {
    const s = loaded();
    s.model!.transact('add', (tx) => void tx.create(rect));
    const seen: string[] = [];
    s.onDidChangeContent((e) => seen.push(e.kind));
    expect(new TextDecoder().decode(s.toBytes())).toContain('"elements"');
    expect(s.replaceContent({ ok: true, doc: createEmptyDocument(), readOnly: false })).toBe(true);
    expect(seen).toEqual(['reset']);
    expect(s.elementCount()).toBe(0);
    expect(s.history!.canUndo()).toBe(false);
  });

  it('writes read-only documents back verbatim and refuses edits', () => {
    const raw = JSON.stringify({ schemaVersion: 9999 });
    const s = new BoardDocumentState('m', loadFromBytes(bytes(raw), parseText));
    expect(s.canEdit).toBe(false);
    expect(new TextDecoder().decode(s.toBytes())).toBe(raw);
  });

  it('invalid documents have no model', () => {
    const s = new BoardDocumentState('m', loadFromBytes(bytes('{'), parseText));
    expect(s.isValid).toBe(false);
    expect(() => s.toBytes()).toThrow();
  });

  it('untitled starts empty', () => {
    expect(BoardDocumentState.untitled('u').elementCount()).toBe(0);
  });
});

describe('sessions and routing', () => {
  function fakeSession(id: string) {
    const posted: HostToWebview[] = [];
    const s: Session = { id, post: (m) => void posted.push(m) };
    return { s, posted };
  }
  const logs: string[] = [];
  const logger = { warn: (m: string) => void logs.push(m) };

  function deps(state: BoardDocumentState, handlers = {}) {
    return { state, accept: createMessageValidation(validators, logger).accept, getSettings: () => settings, logger, handlers };
  }

  it('replies to ready with init and shares one model across tabs', () => {
    const state = loaded();
    const hub = new SessionHub(state);
    const a = fakeSession('a');
    const b = fakeSession('b');
    hub.attach(a.s);
    hub.attach(b.s);
    routeMessage(deps(state), a.s, { type: 'ready' });
    expect(a.posted[0]?.type).toBe('init');

    hub.runAs(a.s, () => state.model!.transact('add', (tx) => void tx.create(rect)));
    expect(a.posted.some((m) => m.type === 'patch')).toBe(false);
    expect(b.posted.some((m) => m.type === 'patch')).toBe(true);
  });

  it('drops invalid messages and ops on read-only documents', () => {
    const ro = new BoardDocumentState('m', loadFromBytes(bytes(JSON.stringify({ schemaVersion: 9999 })), parseText));
    const a = fakeSession('a');
    let ops = 0;
    routeMessage(deps(ro, { op: () => void ops++ }), a.s, { type: 'op', gestureId: 'g', tool: 't' });
    routeMessage(deps(ro), a.s, { type: 'bogus' });
    expect(ops).toBe(0);
    routeMessage(deps(ro), a.s, { type: 'ready' });
    expect(a.posted.map((m) => m.type)).toEqual(['init', 'notice']);
  });

  it('opens and shows the notice above 5,000 elements that use Mockup_Fields, but not at 5,000', () => {
    const mk = (n: number) => {
      const doc = createEmptyDocument();
      doc.elements = Array.from({ length: n }, (_, i) => ({ ...(rect as object), id: `e${i}`, clipContent: i % 2 === 0, parentId: i > 0 ? 'e0' : undefined }) as never);
      return new BoardDocumentState('m', { ok: true, doc, readOnly: false });
    };
    const big = fakeSession('a');
    routeMessage(deps(mk(5001)), big.s, { type: 'ready' });
    expect(big.posted.map((m) => m.type)).toEqual(['init', 'notice']);
    expect(big.posted.some((m) => m.type === 'notice' && m.message === NOTICE_LARGE_BOARD)).toBe(true);
    const edge = fakeSession('b');
    routeMessage(deps(mk(5000)), edge.s, { type: 'ready' });
    expect(edge.posted.map((m) => m.type)).toEqual(['init']);
  });

  it('answers fonts:request with the injected font list, and an empty list without one or on failure', async () => {
    const state = loaded();
    const a = fakeSession('a');
    routeMessage({ ...deps(state), listFonts: async () => ['Arial', 'Inter'] }, a.s, { type: 'fonts:request' });
    routeMessage(deps(state), a.s, { type: 'fonts:request' });
    routeMessage({ ...deps(state), listFonts: () => Promise.reject(new Error('io')) }, a.s, { type: 'fonts:request' });
    await new Promise((r) => setTimeout(r, 0));
    const replies = a.posted.filter((m) => m.type === 'fonts');
    expect(replies).toHaveLength(3);
    expect(replies).toContainEqual({ type: 'fonts', families: ['Arial', 'Inter'] });
    expect(replies.filter((m) => m.type === 'fonts' && m.families.length === 0)).toHaveLength(2);
    // The reply passes the host-to-webview schema.
    for (const m of replies) expect(validators.validateHostToWebview(m)).toBe(true);
  });

  it('shows the large-board notice above 5,000 elements', () => {
    const doc = createEmptyDocument();
    doc.elements = Array.from({ length: 5001 }, (_, i) => ({ ...(rect as object), id: `e${i}` }) as never);
    const state = new BoardDocumentState('m', { ok: true, doc, readOnly: false });
    const a = fakeSession('a');
    routeMessage(deps(state), a.s, { type: 'ready' });
    expect(a.posted.some((m) => m.type === 'notice' && m.message === NOTICE_LARGE_BOARD)).toBe(true);
  });
});

describe('html', () => {
  it('builds a nonce CSP without remote origins or network access', () => {
    const nonce = makeNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
    const csp = buildCsp('vscode-webview://x', nonce);
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).toContain(`connect-src 'none'`);
    expect(csp).not.toMatch(/https?:|\*/);
    const html = buildEditorHtml({ cspSource: 'vscode-webview://x', nonce, scriptUri: 'vscode-webview://x/webview.js' });
    expect(html).toContain(`<script nonce="${nonce}" src="vscode-webview://x/webview.js">`);
  });

  it('invalid panel escapes content, has no canvas root, and offers open as text', () => {
    const html = buildInvalidHtml({ cspSource: 'x', nonce: 'n', message: '<img onerror=x>', offerOpenAsText: true });
    expect(html).not.toContain('<img');
    expect(html).toContain('Open as text');
    expect(html).not.toContain('id="root"');
    expect(isOpenAsTextMessage({ type: 'openAsText' })).toBe(true);
    expect(isOpenAsTextMessage({ type: 'openAsText', x: 1 })).toBe(false);
  });
});
