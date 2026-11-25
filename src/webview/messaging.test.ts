import { describe, expect, it } from 'vitest';
import type { BoardDocument } from '../core/model/types';
import type { Settings } from '../core/settings/settings';
import { createMessaging } from './messaging';
import { WebviewStore } from './store';

const doc = { schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] } as BoardDocument;

function setup(valid = true) {
  const sent: unknown[] = [];
  const store = new WebviewStore();
  const warnings: string[] = [];
  const m = createMessaging({ postMessage: (x) => sent.push(x) }, { validateHostToWebview: () => valid }, store, {}, (w) => warnings.push(w));
  return { sent, store, m, warnings };
}

describe('webview messaging', () => {
  it('sends ready and applies init, patch, and ignores stale revisions', () => {
    const { sent, store, m } = setup();
    m.ready();
    expect(sent).toEqual([{ type: 'ready' }]);
    m.receive({ type: 'init', doc, settings: {} as Settings, readOnly: true });
    expect(store.getState().readOnly).toBe(true);
    const el = { op: 'add', path: ['meta', 'title'], value: 'T' };
    m.receive({ type: 'patch', revision: 1, patches: [el] });
    expect(store.getState().doc?.meta.title).toBe('T');
    m.receive({ type: 'patch', revision: 1, patches: [{ op: 'replace', path: ['meta', 'title'], value: 'X' }] });
    expect(store.getState().doc?.meta.title).toBe('T');
  });

  it('forwards view:command messages (toggle grid / minimap, zoom to fit) to the handler', () => {
    const seen: string[] = [];
    const store = new WebviewStore();
    const m = createMessaging({ postMessage: () => undefined }, { validateHostToWebview: () => true }, store, {
      onViewCommand: (c) => seen.push(c),
    });
    m.receive({ type: 'view:command', command: 'toggleGrid' });
    m.receive({ type: 'view:command', command: 'zoomToFit' });
    expect(seen).toEqual(['toggleGrid', 'zoomToFit']);
  });

  it('drops invalid messages', () => {
    const { store, m, warnings } = setup(false);
    m.receive({ type: 'init' });
    expect(store.getState().doc).toBeUndefined();
    expect(warnings.length).toBe(1);
  });
});
