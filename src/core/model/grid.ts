/** Board grid settings, stored in the file under `settings.grid`. The grid is on unless the file says otherwise. */
import type { BoardDocument, BoardSettings } from './types';

export const DEFAULT_GRID_SPACING = 20;

/** True unless the board explicitly disables the grid (boards without a grid entry default to on). */
export function isGridEnabled(doc: Pick<BoardDocument, 'settings'>): boolean {
  return doc.settings?.grid?.enabled ?? true;
}

/** Settings with the grid flipped; keeps the stored spacing (or uses `fallbackSpacing`) and every other setting. */
export function toggledGridSettings(
  settings: BoardSettings | undefined,
  fallbackSpacing: number = DEFAULT_GRID_SPACING,
): BoardSettings {
  const grid = settings?.grid;
  const enabled = grid?.enabled ?? true;
  return { ...settings, grid: { ...grid, enabled: !enabled, spacing: grid?.spacing ?? fallbackSpacing } };
}
