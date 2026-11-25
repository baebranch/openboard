// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeAdapter } from './ThemeAdapter';

function obVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const style = document.documentElement.style;
  for (let i = 0; i < style.length; i++) {
    const n = style.item(i);
    if (n.startsWith('--ob-')) out[n] = style.getPropertyValue(n);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function applyTheme(cls: string): Record<string, string> {
  document.documentElement.removeAttribute('style');
  document.body.className = cls;
  new ThemeAdapter(document);
  return obVars();
}

afterEach(() => {
  document.body.className = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
});

describe('ThemeAdapter --ob-* variables (Req 4.3)', () => {
  const themes = ['vscode-light', 'vscode-dark', 'vscode-high-contrast'] as const;

  for (const cls of themes) {
    it(`sets the variable map for ${cls}`, () => {
      const vars = applyTheme(cls);
      expect(vars['--ob-bg']).toBeTruthy();
      expect(vars['--ob-ui-border']).toBeTruthy();
      expect(vars).toMatchSnapshot();
    });
  }

  it('gives high-contrast controls the contrast border; other themes the regular border', () => {
    document.body.style.setProperty('--vscode-contrastBorder', '#ff00ff');
    document.body.style.setProperty('--vscode-panel-border', '#112233');
    const hc = applyTheme('vscode-high-contrast');
    // applyTheme clears documentElement style only; body style variables remain.
    expect(hc['--ob-hc']).toBe('1');
    expect(hc['--ob-ui-border']).toBe(hc['--ob-contrast-border']);
    expect(hc['--ob-ui-border-width']).toBe('1px');
    const dark = applyTheme('vscode-dark');
    expect(dark['--ob-hc']).toBe('0');
    expect(dark['--ob-ui-border']).toBe(dark['--ob-border']);
  });

  it('re-themes on body class changes', async () => {
    document.body.className = 'vscode-dark';
    const a = new ThemeAdapter(document);
    a.start();
    document.body.className = 'vscode-light';
    await new Promise((r) => setTimeout(r, 300));
    expect(document.documentElement.style.getPropertyValue('--ob-hc')).toBe('0');
    expect(a.getPalette().kind).toBe('light');
    a.stop();
  });
});
