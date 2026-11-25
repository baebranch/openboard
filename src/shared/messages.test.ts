// Test-only: compiles the message schemas with Ajv using the same options as the build script
// (avoids racing other suites on dist/validators.js).
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildMessageSchemas } from '../core/schema';
import { createMessageValidation, type MessageValidators } from './messages';

const ajv = new Ajv({ allErrors: false, strict: true, discriminator: true });
const schemas = buildMessageSchemas();
const validators = {
  validateWebviewToHost: ajv.compile(schemas['validateWebviewToHost']!),
  validateHostToWebview: ajv.compile(schemas['validateHostToWebview']!),
} as MessageValidators;
const logs: string[] = [];
const mv = () => createMessageValidation(validators, { warn: (m) => logs.push(m) });

describe('message protocol validation', () => {
  it('accepts every webview->host message type', () => {
    const { validate } = mv();
    const msgs = [
      { type: 'ready' },
      { type: 'op', gestureId: 'g1', tool: 'board.add', input: { a: 1 } },
      { type: 'viewport', viewport: { x: 0, y: 0, zoom: 1 } },
      { type: 'selection', ids: ['a', 'b'] },
      { type: 'export:result', requestId: 'r', bytes: 'AA==', mime: 'image/png' },
      { type: 'render:result', requestId: 'r', png: 'AA==' },
      { type: 'export:cancel', requestId: 'r', reason: 'x' },
      { type: 'log', level: 'warn', message: 'hi' },
    ];
    for (const m of msgs) expect(validate('webview-to-host', m).ok).toBe(true);
  });

  it('accepts every host->webview message type', () => {
    const { validate } = mv();
    const patches = [{ op: 'replace', path: ['elements', 0, 'x'], value: 1 }];
    const msgs = [
      { type: 'init', doc: {}, settings: {}, readOnly: false },
      { type: 'ack', gestureId: 'g', revision: 2, patches },
      { type: 'patch', revision: 3, patches },
      { type: 'reset', doc: {} },
      { type: 'settings', settings: {} },
      { type: 'render:request', requestId: 'r', spec: {} },
      { type: 'notice', level: 'info', message: 'x' },
      { type: 'view:command', command: 'toggleGrid' },
      { type: 'view:command', command: 'zoomToFit' },
    ];
    for (const m of msgs) expect(validate('host-to-webview', m).ok).toBe(true);
  });

  it('rejects malformed messages', () => {
    const { validate } = mv();
    const bad = [
      null,
      'ready',
      [],
      {},
      { type: 'nope' },
      { type: 'op', gestureId: 'g' },
      { type: 'log', level: 'error', message: 'x' },
      { type: 'viewport', viewport: { x: 'a', y: 0, zoom: 1 } },
    ];
    for (const m of bad) expect(validate('webview-to-host', m).ok).toBe(false);
    expect(validate('host-to-webview', { type: 'patch', revision: -1, patches: [] }).ok).toBe(false);
    expect(validate('host-to-webview', { type: 'ready' }).ok).toBe(false);
  });

  it('drops and logs invalid messages, passes valid ones', () => {
    logs.length = 0;
    const { accept } = mv();
    expect(accept('webview-to-host', { type: 'ready' })).toEqual({ type: 'ready' });
    expect(logs).toHaveLength(0);
    expect(accept('webview-to-host', { type: 'bogus' })).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('webview-to-host');
  });
});
