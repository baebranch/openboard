import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeHtml, htmlToRuns, runsToHtml, svgToDataUri } from '../../src/core/text';

// Feature: openboard, Property 25: Text content is sanitized
// **Validates: Requirements 16.3**

const fragments = [
  '<script>alert(1)</script>',
  '<SCRIPT src=x>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">link</a>',
  '<b onclick="x()">bold</b>',
  '<i>',
  '</i>',
  '<u>',
  '</u>',
  '<b>',
  '</b>',
  '<br/>',
  '<p>',
  '</p>',
  '<style>*{}</style>',
  '<iframe src=javascript:1></iframe>',
  '<!-- c -->',
  '<scr<script>ipt>',
  '&lt;script&gt;',
  '&#60;img onerror=x&#62;',
  '&amp;lt;',
  '"',
  "'",
  '<',
  '>',
  '&',
  ' onmouseover=alert(1) ',
  'javascript:alert(1)',
];

const hostileHtml = fc
  .array(fc.oneof(fc.constantFrom(...fragments), fc.string({ maxLength: 8 })), { maxLength: 12 })
  .map((parts) => parts.join(''));

const runArb = fc.record(
  {
    text: fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom(...fragments)),
    bold: fc.boolean(),
    italic: fc.boolean(),
    underline: fc.boolean(),
  },
  { requiredKeys: ['text'] },
);

const ALLOWED_TAG = /^<\/?(b|i|u)>$|^<br>$/;

function tagsOf(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

describe('Feature: openboard, Property 25: Text content is sanitized', () => {
  it('imported runs only carry text and bold/italic/underline flags', () => {
    fc.assert(
      fc.property(hostileHtml, (html) => {
        for (const run of htmlToRuns(html)) {
          expect(Object.keys(run).every((k) => ['text', 'bold', 'italic', 'underline'].includes(k))).toBe(true);
          expect(typeof run.text).toBe('string');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('rendered HTML of imported content has only b/i/u/br tags and no raw angle brackets in text', () => {
    fc.assert(
      fc.property(hostileHtml, (html) => {
        const out = runsToHtml(htmlToRuns(html));
        const tags = tagsOf(out);
        expect(tags.every((t) => ALLOWED_TAG.test(t))).toBe(true);
        // Removing the whitelisted tags must leave no '<' or '>' at all.
        const rest = out.replace(/<\/?(b|i|u)>|<br>/g, '');
        expect(rest).not.toMatch(/[<>]/);
        expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/href\s*=/i);
      }),
      { numRuns: 200 },
    );
  });

  it('rendering arbitrary runs never emits script or event-handler markup', () => {
    fc.assert(
      fc.property(fc.array(runArb, { maxLength: 8 }), (runs) => {
        const out = runsToHtml(runs);
        expect(tagsOf(out).every((t) => ALLOWED_TAG.test(t))).toBe(true);
        expect(out.replace(/<\/?(b|i|u)>|<br>/g, '')).not.toMatch(/[<>"']/);
      }),
      { numRuns: 200 },
    );
  });

  it('escapeHtml output has no raw < > " \' and every & starts an entity; it is injective', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...fragments)), fc.string(), (a, b) => {
        const ea = escapeHtml(a);
        expect(ea).not.toMatch(/[<>"']/);
        expect(ea.replace(/&(amp|lt|gt|quot|#39);/g, '')).not.toMatch(/&/);
        if (a !== b) expect(escapeHtml(b)).not.toBe(ea);
      }),
      { numRuns: 200 },
    );
  });

  it('svgToDataUri yields an inert image data URI with no raw markup characters', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...fragments)), (svg) => {
        const uri = svgToDataUri(svg);
        expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
        const payload = uri.slice('data:image/svg+xml;charset=utf-8,'.length);
        expect(payload).not.toMatch(/[<>"'\s]/);
        expect(decodeURIComponent(payload)).toBe(svg);
      }),
      { numRuns: 200 },
    );
  });
});
