import { useSyncExternalStore } from 'react';
import type { ThemePalette } from '../../core/theme';
import { getThemeAdapter } from './ThemeAdapter';

/** React hook returning the live theme palette; re-renders on theme change. */
export function useThemePalette(): ThemePalette {
  const adapter = getThemeAdapter();
  return useSyncExternalStore(
    (cb) => adapter.subscribe(cb),
    () => adapter.getPalette(),
    () => adapter.getPalette(),
  );
}
