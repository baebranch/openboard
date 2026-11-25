import { beforeAll, describe, expect, it } from 'vitest';
import { getBoardValidator } from '../../../test/helpers/validator';
import { renderElementToSvg, renderToSvg } from '../export/svg';
import { effectiveSchemaVersion } from '../format/schema-version';
import { parse, setBoardValidator } from '../format/parser';
import { serialize } from '../format/serializer';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { builtinPalette } from '../theme';
import { DefaultToolRegistry } from '../tools/registry';
import { registerTokenTools } from '../tools/token-tools';
import { colorForMode, hasModeTokens, resolveMode, resolveTokens, validateTokenValue } from './index';

const style = { fill: 'theme:default', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (fill: string): Element =>
  ({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...style, fill } }) as Element;

const modes = { light: '#ffffff', dark: '#111111' };

function doc(extra: Partial<BoardDocument> = {}): BoardDocument {
  return {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [rect('token:bg')],
    assets: [],
    library: [],
    tokens: { colors: { bg: modes, plain: '#ff0000' } },
    ...extra,
  };
}

beforeAll(() => setBoardValidator(getBoardValidator()), 60_000);

describe('token modes', () => {
  it('validates one literal or exactly a light and dark pair', () => {
    expect(validateTokenValue('colors', modes).ok).toBe(true);
    expect(validateTokenValue('colors', { light: '#fff' }).ok).toBe(false);
    expect(validateTokenValue('colors', { light: '#fff', dark: 'nope' }).ok).toBe(false);
    expect(validateTokenValue('colors', { light: 'token:x', dark: '#000' })).toMatchObject({ code: 'token_reference_value' });
    expect(validateTokenValue('fonts', modes).ok).toBe(false);
    expect(hasModeTokens({ colors: { a: modes } })).toBe(true);
    expect(hasModeTokens({ colors: { a: '#fff' } })).toBe(false);
  });

  it('resolves a mode: explicit wins, auto follows the theme kind', () => {
    expect(resolveMode('light', 'dark')).toBe('light');
    expect(resolveMode('dark', 'light')).toBe('dark');
    expect(resolveMode(undefined, 'dark')).toBe('dark');
    expect(resolveMode('auto', 'high-contrast')).toBe('dark');
    expect(resolveMode('auto', 'high-contrast-light')).toBe('light');
    expect(resolveMode('auto', 'light')).toBe('light');
  });

  it('shows a single literal in every mode and the mode value for a pair', () => {
    expect(colorForMode('#ff0000', 'dark')).toBe('#ff0000');
    expect(resolveTokens({ colors: { bg: modes } }, 'dark').colors.get('bg')).toBe('#111111');
    expect(resolveTokens({ colors: { bg: modes } }, 'light').colors.get('bg')).toBe('#ffffff');
  });

  it('renders the active mode and follows the theme kind in auto', () => {
    const d = doc();
    const el = d.elements[0]!;
    const dark = renderElementToSvg(el, { ...d, settings: { activeMode: 'dark' } }, builtinPalette('light'));
    const light = renderElementToSvg(el, { ...d, settings: { activeMode: 'light' } }, builtinPalette('dark'));
    expect(dark).toContain('#111111');
    expect(light).toContain('#ffffff');
    expect(renderElementToSvg(el, d, builtinPalette('dark'))).toContain('#111111');
    expect(renderElementToSvg(el, d, builtinPalette('light'))).toContain('#ffffff');
  });

  it('exports in the chosen mode without touching the stored mode', () => {
    const d = doc({ settings: { activeMode: 'light' } });
    const svg = (tokenMode?: 'light' | 'dark' | 'active') => {
      const r = renderToSvg(d, [d.elements[0]!], tokenMode ? { tokenMode } : {});
      if (!r.ok) throw new Error('render failed');
      return r.value.svg;
    };
    expect(svg()).toContain('#ffffff');
    expect(svg('active')).toContain('#ffffff');
    expect(svg('dark')).toContain('#111111');
    expect(svg('dark')).not.toContain('token:');
    expect(d.settings?.activeMode).toBe('light');
  });

  it('round-trips pairs and activeMode, and writes schema 2 only when used', () => {
    const d = doc({ settings: { activeMode: 'dark' } });
    expect(effectiveSchemaVersion(d)).toBe(2);
    const r = parse(serialize(d));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.tokens?.colors?.bg).toEqual(modes);
      expect(r.doc.settings?.activeMode).toBe('dark');
      expect(serialize(r.doc)).toBe(serialize(d));
    }
    const bad = JSON.parse(serialize(d));
    bad.tokens.colors.bg = { light: '#ffffff' };
    expect(parse(JSON.stringify(bad)).ok).toBe(false);
    bad.tokens.colors.bg = modes;
    bad.settings.activeMode = 'sepia';
    expect(parse(JSON.stringify(bad)).ok).toBe(false);
    expect(effectiveSchemaVersion({ ...doc(), tokens: undefined, elements: [], settings: { grid: { enabled: true, spacing: 20 } } })).toBe(1);
  });

  it('sets the mode as one undo entry and a no-op change records nothing', async () => {
    const history = new UndoHistory();
    const model = new BoardModel('/b.openboard', doc(), { history });
    const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
    registerTokenTools(reg);
    const run = (input: unknown) => reg.invoke('openboard.token.mode', input) as Promise<any>;

    const before = history.undoCount();
    expect(await run({ mode: 'auto' })).toEqual({ mode: 'auto' });
    expect(history.undoCount()).toBe(before);
    await run({ mode: 'dark' });
    expect(model.getDocument().settings?.activeMode).toBe('dark');
    expect(history.undoCount()).toBe(before + 1);
    expect((await run({ mode: 'sepia' })).error).toBeDefined();
    expect(history.undo(model)).toBe(true);
    expect(model.getDocument().settings?.activeMode).toBeUndefined();
  });

  it('creates and updates a color token with a light and dark value', async () => {
    const model = new BoardModel('/b.openboard', doc({ tokens: undefined, elements: [] }), { history: new UndoHistory() });
    const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
    registerTokenTools(reg);
    await reg.invoke('openboard.token.create', { category: 'colors', name: 'bg', value: modes });
    expect(model.getDocument().tokens?.colors?.bg).toEqual(modes);
    await reg.invoke('openboard.token.update', { category: 'colors', name: 'bg', value: '#abcdef' });
    expect(model.getDocument().tokens?.colors?.bg).toBe('#abcdef');
  });
});
