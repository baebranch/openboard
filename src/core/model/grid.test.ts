import { describe, expect, it } from 'vitest';
import { isGridEnabled, toggledGridSettings } from './grid';
import type { BoardSettings } from './types';

describe('isGridEnabled', () => {
  it('defaults to on when settings or grid are missing', () => {
    expect(isGridEnabled({ settings: undefined })).toBe(true);
    expect(isGridEnabled({ settings: {} })).toBe(true);
    expect(isGridEnabled({ settings: { minimap: true } })).toBe(true);
  });

  it('honours an explicit value', () => {
    expect(isGridEnabled({ settings: { grid: { enabled: false, spacing: 20 } } })).toBe(false);
    expect(isGridEnabled({ settings: { grid: { enabled: true, spacing: 20 } } })).toBe(true);
  });
});

describe('toggledGridSettings', () => {
  it('turns a default (missing) grid off', () => {
    expect(toggledGridSettings(undefined, 16).grid).toEqual({ enabled: false, spacing: 16 });
  });

  it('round-trips when toggled twice', () => {
    const start: BoardSettings = { grid: { enabled: true, spacing: 32 } };
    const off = toggledGridSettings(start, 20);
    expect(off.grid?.enabled).toBe(false);
    expect(toggledGridSettings(off, 20)).toEqual(start);
  });

  it('keeps stored spacing and other settings', () => {
    const out = toggledGridSettings({ minimap: true, grid: { enabled: true, spacing: 40 } }, 10);
    expect(out).toEqual({ minimap: true, grid: { enabled: false, spacing: 40 } });
  });

  it('uses the fallback spacing only when none is stored', () => {
    expect(toggledGridSettings({ minimap: false }, 25)).toEqual({ minimap: false, grid: { enabled: false, spacing: 25 } });
  });
});
