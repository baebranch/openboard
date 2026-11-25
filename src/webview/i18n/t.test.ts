import { describe, expect, it } from 'vitest';
import { setBundle, t } from './t';

describe('t()', () => {
  it('falls back to the key text', () => {
    expect(t('No such key')).toBe('No such key');
  });
  it('looks up the bundle and substitutes args', () => {
    setBundle({ Hello: 'Hi {0}, {1}' });
    expect(t('Hello', 'Ann', 2)).toBe('Hi Ann, 2');
    expect(t('Hello')).toBe('Hi {0}, {1}');
  });
});
