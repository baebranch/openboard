import { describe, expect, it } from 'vitest';
import {
  applyStyleToRange,
  escapeHtml,
  htmlToRuns,
  rangeHasStyle,
  runsToHtml,
  runsToPlainText,
  svgToDataUri,
} from './runs';

describe('text runs', () => {
  it('applies style to a range, splitting and merging runs', () => {
    const runs = applyStyleToRange([{ text: 'hello world' }], 2, 7, 'bold', true);
    expect(runs).toEqual([{ text: 'he' }, { text: 'llo w', bold: true }, { text: 'orld' }]);
    expect(rangeHasStyle(runs, 2, 7, 'bold')).toBe(true);
    const back = applyStyleToRange(runs, 0, 11, 'bold', false);
    expect(back).toEqual([{ text: 'hello world' }]);
  });

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('imports only whitelisted formatting', () => {
    const runs = htmlToRuns(
      '<p onclick="x()">a <b>b<i>c</i></b><script>alert(1)</script><img src=x onerror=y> &lt;d&gt;</p>',
    );
    expect(runsToPlainText(runs)).toBe('a bc <d>');
    expect(runs[1]).toEqual({ text: 'b', bold: true });
    expect(runs[2]).toEqual({ text: 'c', bold: true, italic: true });
  });

  it('round-trips through html', () => {
    const runs = [{ text: 'a<b' }, { text: 'x\ny', underline: true }];
    expect(htmlToRuns(runsToHtml(runs))).toEqual(runs);
  });

  it('encodes svg as image data uri', () => {
    const uri = svgToDataUri('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(uri).not.toContain('<');
  });
});
