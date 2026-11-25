import { describe, expect, it } from 'vitest';
import { writePdf } from './pdf';

const latin = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

describe('writePdf', () => {
  const pdf = writePdf([
    { width: 100, height: 50, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
    { width: 20, height: 10, pixelWidth: 2, pixelHeight: 1, rgb: new Uint8Array(6) },
  ]);
  const text = latin(pdf);

  it('has header, trailer and EOF', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Root 1 0 R');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('has one page per input with matching MediaBox', () => {
    expect(text).toContain('/Count 2');
    expect(text.match(/\/Type \/Page /g)?.length).toBe(2);
    expect(text).toContain('/MediaBox [0 0 100 50]');
    expect(text).toContain('/MediaBox [0 0 20 10]');
  });

  it('has correct xref offsets and startxref', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const lines = text.slice(start).split('\n');
    const count = Number(lines[1]!.split(' ')[1]);
    expect(count).toBe(1 + 2 + 2 * 3);
    for (let id = 1; id < count; id++) {
      const off = Number(lines[2 + id]!.slice(0, 10));
      expect(text.slice(off).startsWith(`${id} 0 obj`)).toBe(true);
    }
  });

  it('rejects empty input and mismatched rgb data', () => {
    expect(() => writePdf([])).toThrow();
    expect(() => writePdf([{ width: 1, height: 1, rgb: new Uint8Array(1) }])).toThrow();
  });
});
