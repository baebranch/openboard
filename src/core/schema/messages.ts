import { s, type JsonSchema } from './builder';

/**
 * JSON Schemas for the webview/host message protocol (Req 16.5).
 * Payload bodies (boards, settings, patches, tool input) are validated structurally only;
 * deep validation happens where they are consumed (tool schemas, Board_File schema).
 */

const obj = (): JsonSchema => s.object({});
const viewport = s.object({ x: s.number(), y: s.number(), zoom: s.number() });
const patch = s.object({
  op: s.enum(['add', 'replace', 'remove']),
  path: s.array({ anyOf: [s.string(), s.number()] }),
});
const msg = (type: string, shape: Parameters<typeof s.object>[0] = {}): JsonSchema =>
  s.object({ type: s.const(type), ...shape });

export function buildWebviewToHostSchema(): JsonSchema {
  return s.union('type', [
    msg('ready'),
    msg('op', { gestureId: s.string({ minLength: 1 }), tool: s.string({ minLength: 1 }), input: s.opt({}) }),
    msg('viewport', { viewport }),
    msg('selection', { ids: s.array(s.string()) }),
    msg('export:result', { requestId: s.string({ minLength: 1 }), bytes: s.string(), mime: s.string() }),
    msg('render:result', { requestId: s.string({ minLength: 1 }), png: s.string() }),
    msg('export:cancel', { requestId: s.string({ minLength: 1 }), reason: s.opt(s.string()) }),
    msg('log', { level: s.enum(['info', 'warn']), message: s.string() }),
  ]);
}

export function buildHostToWebviewSchema(): JsonSchema {
  return s.union('type', [
    msg('init', { doc: obj(), settings: obj(), readOnly: s.boolean() }),
    msg('ack', { gestureId: s.string({ minLength: 1 }), revision: s.integer({ min: 0 }), patches: s.array(patch) }),
    msg('patch', { revision: s.integer({ min: 0 }), patches: s.array(patch) }),
    msg('reset', { doc: obj() }),
    msg('settings', { settings: obj() }),
    msg('viewport', { viewport }),
    msg('render:request', { requestId: s.string({ minLength: 1 }), spec: obj() }),
    msg('notice', { level: s.string(), message: s.string() }),
    msg('view:command', { command: s.enum(['zoomToFit', 'toggleGrid', 'toggleMinimap']) }),
  ]);
}

/** Schemas compiled into dist/validators.js by scripts/build-schemas.mjs. */
export function buildMessageSchemas(): Record<string, JsonSchema> {
  return {
    validateWebviewToHost: buildWebviewToHostSchema(),
    validateHostToWebview: buildHostToWebviewSchema(),
  };
}
