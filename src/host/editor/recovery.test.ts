import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { parse } from '../../core/format/parser';
import { buildBoardSchema } from '../../core/schema/board';
import { buildMessageSchemas } from '../../core/schema/messages';
import { createMessageValidation, type MessageValidators } from '../../shared/messages';
import type { Settings } from '../../core/settings/settings';
import { loadFromBytes } from './loader';
import { NOTICE_UNACKED_EDITS, RenderBroker, type HiddenRenderPanel } from './recovery';
import { SessionHub, routeMessage } from './session';
import { BoardDocumentState } from './state';
import { FakeScheduler, SimulatedWebview, converged } from './syncHarness';

const ajv = new Ajv({ strict: false, discriminator: true });
const schemas = buildMessageSchemas();
const validators = {
  validateWebviewToHost: ajv.compile(schemas['validateWebviewToHost']!),
  validateHostToWebview: ajv.compile(schemas['validateHostToWebview']!),
} as MessageValidators;
const validateBoard = ajv.compile(buildBoardSchema());
const settings = {} as Settings;
const logger = { warn: () => undefined };
const accept = createMessageValidation(validators, logger).accept;

function newState(): BoardDocumentState {
  return new BoardDocumentState('mem', loadFromBytes(new TextEncoder().encode(''), (t) => parse(t, { validator: validateBoard })));
}
const rect = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, locked: false, style: {} } as never;
const add = (state: BoardDocumentState) => state.model!.transact('add', (tx) => void tx.create(rect));
const deps = (state: BoardDocumentState, hub: SessionHub) => ({ state, accept, getSettings: () => settings, logger, hub });

describe('multi-session sync', () => {
  it('acks the origin and patches the others with matching revisions; all converge', () => {
    const state = newState();
    const hub = new SessionHub(state);
    const views = [new SimulatedWebview('a'), new SimulatedWebview('b'), new SimulatedWebview('c')];
    for (const v of views) {
      hub.attach(v.session);
      routeMessage(deps(state, hub), v.session, { type: 'ready' });
    }
    hub.runGesture(views[0]!.session, 'g1', () => add(state));
    hub.runGesture(views[1]!.session, 'g2', () => add(state));
    add(state);
    expect(views[0]!.acked).toEqual(['g1']);
    expect(views[1]!.acked).toEqual(['g2']);
    expect(views.map((v) => v.revision)).toEqual([3, 3, 3]);
    expect(views.every((v) => v.gaps.length === 0)).toBe(true);
    expect(converged(state.getDocument(), views)).toBe(true);
    expect(state.getDocument()!.elements).toHaveLength(3);
    expect(hub.pendingGestures(views[0]!.session)).toEqual([]);
  });
});

describe('viewport retention', () => {
  it('stores viewport messages and re-sends them when the tab becomes visible', () => {
    const state = newState();
    const hub = new SessionHub(state);
    const v = new SimulatedWebview('a');
    hub.attach(v.session);
    routeMessage(deps(state, hub), v.session, { type: 'viewport', viewport: { x: 5, y: 6, zoom: 2 } });
    hub.setVisible(v.session, false);
    expect(v.received.some((m) => m.type === 'viewport')).toBe(false);
    hub.setVisible(v.session, true);
    expect(v.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
  });
});

describe('watchdog and restart', () => {
  it('fires when no ready arrives, and not when the webview reports in time', () => {
    const state = newState();
    const hub = new SessionHub(state);
    const sched = new FakeScheduler();
    let restarts = 0;
    const slow = new SimulatedWebview('slow');
    const ok = new SimulatedWebview('ok');
    hub.attach(slow.session, { onUnresponsive: () => void restarts++, scheduler: sched });
    hub.attach(ok.session, { onUnresponsive: () => (restarts += 100), scheduler: sched });
    sched.advance(1000);
    routeMessage(deps(state, hub), ok.session, { type: 'ready' });
    sched.advance(3999); // total 4999 ms < 5 s bound
    expect(restarts).toBe(1);
  });

  it('after restart, ready re-sends init and warns about unacked gestures', () => {
    const state = newState();
    const hub = new SessionHub(state);
    const sched = new FakeScheduler();
    const v = new SimulatedWebview('a');
    hub.attach(v.session, { onUnresponsive: () => hub.rearm(v.session), scheduler: sched });
    routeMessage(deps(state, hub), v.session, { type: 'ready' });
    // async op received but never acked before the crash
    routeMessage({ ...deps(state, hub), handlers: { op: () => undefined } }, v.session, {
      type: 'op',
      gestureId: 'lost',
      tool: 't',
    });
    expect(hub.pendingGestures(v.session)).toEqual(['lost']);
    add(state); // host document advances while the webview is dead
    v.received.length = 0;
    routeMessage(deps(state, hub), v.session, { type: 'ready' });
    expect(v.received.map((m) => m.type)).toEqual(['init', 'notice']);
    expect(v.received[1]).toMatchObject({ message: NOTICE_UNACKED_EDITS });
    expect(v.doc!.elements).toHaveLength(1);
    expect(hub.pendingGestures(v.session)).toEqual([]);
  });
});

describe('RenderBroker', () => {
  it('uses the editor session when open, else a hidden panel that is disposed afterwards', async () => {
    const editor = new SimulatedWebview('ed');
    let open = true;
    let created = 0;
    let disposed = 0;
    const hiddenView = new SimulatedWebview('hidden');
    const broker: RenderBroker = new RenderBroker({
      getEditorSession: () => (open ? editor.session : undefined),
      createHiddenPanel: (): HiddenRenderPanel => {
        created++;
        return { session: hiddenView.session, whenReady: async () => undefined, dispose: () => void disposed++ };
      },
    });
    const p1 = broker.render({});
    await Promise.resolve();
    expect(editor.received.some((m) => m.type === 'render:request')).toBe(true);
    expect(broker.handleResult('r1', 'PNG1')).toBe(true);
    await expect(p1).resolves.toBe('PNG1');
    expect(created).toBe(0);

    open = false;
    const p2 = broker.render({});
    await new Promise((r) => setTimeout(r, 0));
    expect(hiddenView.received.some((m) => m.type === 'render:request')).toBe(true);
    broker.handleResult('r2', 'PNG2');
    await expect(p2).resolves.toBe('PNG2');
    expect(created).toBe(1);
    expect(disposed).toBe(1);
    expect(broker.hasHiddenPanel).toBe(false);
  });

  it('times out', async () => {
    const sched = new FakeScheduler();
    const v = new SimulatedWebview('ed');
    const broker = new RenderBroker({
      getEditorSession: () => v.session,
      createHiddenPanel: () => {
        throw new Error('unused');
      },
      scheduler: sched,
      timeoutMs: 100,
    });
    const p = broker.render({});
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await Promise.resolve();
    sched.advance(100);
    await assertion;
  });
});
