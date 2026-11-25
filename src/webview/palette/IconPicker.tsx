import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ICON_NAMES, ICON_PATHS, searchIcons } from '../../core/icons';
import { t } from '../i18n/t';

/** Number of glyph columns the grid arrows move across; matches the CSS grid. */
const COLUMNS = 6;

/** Names shown for `query`: the whole Icon_Set when empty, otherwise the (capped) search result. */
export function pickerResults(query: string): readonly string[] {
  return query.trim() === '' ? ICON_NAMES : searchIcons(query.trim());
}

/** Roving focus target in the glyph grid; undefined when the key is not handled. */
export function nextGlyphIndex(current: number, count: number, key: string): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowRight':
      return Math.min(current + 1, count - 1);
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'ArrowDown':
      return Math.min(current + COLUMNS, count - 1);
    case 'ArrowUp':
      return Math.max(current - COLUMNS, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export interface IconPickerProps {
  selected: string | undefined;
  onChoose: (name: string) => void;
  onClose: () => void;
}

/** Searchable icon grid opened by the Icon tool (Req 23.3, 23.8). */
export function IconPicker({ selected, onChoose, onClose }: IconPickerProps) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => pickerResults(query), [query]);
  const search = useRef<HTMLInputElement>(null);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => search.current?.focus(), []);

  const onKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const [active, setActive] = useState(0);
  const tabbable = Math.min(active, Math.max(0, results.length - 1));

  const onCellKey = (e: ReactKeyboardEvent, index: number): void => {
    const next = nextGlyphIndex(index, results.length, e.key);
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation(); // keep arrows away from canvas nudge shortcuts
      setActive(next);
      cells.current[next]?.focus();
    }
  };

  return (
    <div role="dialog" aria-label={t('Icon picker')} className="ob-icon-picker" data-ob-icon-picker="" onKeyDown={onKey}>
      <input
        ref={search}
        type="search"
        aria-label={t('Search icons')}
        placeholder={t('Search icons')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && results.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            cells.current[tabbable]?.focus();
          }
        }}
      />
      <p role="status" className="ob-icon-picker-status">
        {results.length === 0 ? t('No icons match') : selected ? t('Selected icon: {0}', selected) : t('{0} icons', results.length)}
      </p>
      <ul className="ob-icon-picker-grid" role="list">
        {results.map((name, i) => (
          <li key={name} role="listitem">
            <button
              type="button"
              ref={(el) => {
                cells.current[i] = el;
              }}
              aria-label={t('Choose icon: {0}', name)}
              aria-pressed={name === selected}
              title={name}
              tabIndex={i === tabbable ? 0 : -1}
              onFocus={() => setActive(i)}
              onKeyDown={(e) => onCellKey(e, i)}
              onClick={() => onChoose(name)}
            >
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d={ICON_PATHS[name]} />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
