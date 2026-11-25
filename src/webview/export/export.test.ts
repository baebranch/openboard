import { describe, expect, it } from 'vitest';
import { copyAsPng, handleRenderRequest } from './actions';
import {
  applyPaddingInput,
  buildOptions,
  copyOptions,
  initialDialogState,
  previewExport,
  setFormat,
  type DialogState,
  toToolInput,
} from './model';
import { base64ToBytes, bytesToBase64, hasRemoteReference, parseRenderSpec, planRaster } from './plan';
import type { WebviewToHost } from '../../shared/messages';

const el = (id: string, x: number, w = 100, type = 'rect') =>
  ({ id, type, x, y: 0, width: w, height: 50, rotation: 0 }) as never;
const doc = (...elements: unknown[]) => ({ elements, assets: [] }) as never;

describe('plan', () => {
  const base = { svg: '<svg/>', format: 'png', scale: 2, width: 100, height: 50, background: 'white' };
  it('parses and plans pixel size, fill and quality', () => {
    const p = parseRenderSpec(base);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = planRaster({ ...p.spec, format: 'jpeg' });
    expect(r).toMatchObject({ ok: true, plan: { pixelWidth: 200, pixelHeight: 100, mime: 'image/jpeg', fill: '#ffffff' } });
    const png = planRaster(p.spec);
    expect(png.ok && png.plan.fill).toBeUndefined();
  });
  it('rejects bad specs, remote refs and oversize output', () => {
    expect(parseRenderSpec({ ...base, scale: 5 }).ok).toBe(false);
    expect(parseRenderSpec({ ...base, format: 'gif' }).ok).toBe(false);
    expect(parseRenderSpec(null).ok).toBe(false);
    expect(hasRemoteReference('<image href="https://x/y.png"/>')).toBe(true);
    expect(hasRemoteReference('<image href="data:image/png;base64,AA=="/>')).toBe(false);
    const big = parseRenderSpec({ ...base, width: 5000, scale: 4 });
    expect(big.ok && planRaster(big.spec)).toMatchObject({ ok: false });
  });
  it('round-trips base64', () => {
    const b = new Uint8Array(70000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
});

describe('model', () => {
  it('keeps the previous padding on invalid input', () => {
    const s = { ...initialDialogState(), padding: 10, paddingText: '10' };
    for (const bad of ['', '1.5', '-1', '257', 'abc']) {
      const r = applyPaddingInput(s, bad);
      expect(r.error).toMatch(/0 to 256/);
      expect(r.state.padding).toBe(10);
    }
    expect(applyPaddingInput(s, ' 256 ').state.padding).toBe(256);
  });
  it('normalises options when the format changes', () => {
    let s: DialogState = { ...initialDialogState(), background: 'transparent', embedBoard: true };
    s = setFormat(s, 'jpeg');
    expect(s.background).toBe('white');
    expect(buildOptions({ ...s, scale: 3 }, [])).toMatchObject({ scale: 3 });
    expect(buildOptions({ ...s, format: 'svg', scale: 3 }, []).scale).toBe(1);
  });
  it('previews size and reports empty scope and size limit', () => {
    const d = doc(el('a', 0));
    const o = buildOptions({ ...initialDialogState(), padding: 10, scale: 2 }, []);
    expect(previewExport(d, o)).toMatchObject({ ok: true, sizes: [{ w: 240, h: 140 }] });
    const sel = buildOptions({ ...initialDialogState(), scopeKind: 'selection' }, []);
    expect(previewExport(d, sel).error).toMatch(/nothing to export/);
    const wide = doc(el('a', 0, 5000));
    expect(previewExport(wide, buildOptions({ ...initialDialogState(), scale: 4 }, [])).error).toMatch(/16,384/);
    expect(previewExport(d, buildOptions({ ...initialDialogState(), scopeKind: 'allFrames' }, [])).error).toMatch(/nothing/);
  });
  it('builds tool input', () => {
    const o = buildOptions({ ...initialDialogState(), scopeKind: 'selection', embedBoard: true }, ['a']);
    expect(toToolInput(o)).toMatchObject({ format: 'png', scope: 'selection', ids: ['a'], embedBoard: true });
    expect(copyOptions([]).scope).toEqual({ kind: 'board' });
  });
});

describe('actions', () => {
  it('replies with render:result, or export:cancel on failure', async () => {
    const sent: WebviewToHost[] = [];
    const notes: string[] = [];
    const deps = (fail: boolean) => ({
      send: (m: WebviewToHost) => sent.push(m),
      notify: (_l: string, m: string) => notes.push(m),
      rasterize: async () => {
        if (fail) throw new Error('boom');
        return 'AA==';
      },
    });
    const spec = { svg: '<svg/>', format: 'png', scale: 1, width: 10, height: 10 };
    await handleRenderRequest(deps(false), 'r1', spec);
    await handleRenderRequest(deps(false), 'r2', { ...spec, reply: 'export' });
    await handleRenderRequest(deps(true), 'r3', spec);
    await handleRenderRequest(deps(false), 'r4', {});
    expect(sent.map((m) => m.type)).toEqual(['render:result', 'export:result', 'export:cancel', 'export:cancel']);
    expect(notes).toHaveLength(2);
  });
  it('copies as PNG and reports clipboard failure', async () => {
    const notes: string[] = [];
    let written = 0;
    const mk = (fail: boolean) => ({
      notify: (_l: string, m: string) => notes.push(m),
      rasterize: async () => new Blob(['x'], { type: 'image/png' }),
      writeClipboard: async () => {
        if (fail) throw new Error('denied');
        written++;
      },
    });
    const d = doc(el('a', 0));
    expect(await copyAsPng(mk(false), d, [])).toBe(true);
    expect(written).toBe(1);
    expect(await copyAsPng(mk(true), d, [])).toBe(false);
    expect(notes.at(-1)).toMatch(/Copy as PNG failed/);
    expect(await copyAsPng(mk(false), doc(), [])).toBe(false);
    expect(notes.at(-1)).toMatch(/nothing to export/);
  });
});
