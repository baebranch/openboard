/**
 * Small accessible, theme-aware dropdown (APG "select-only combobox"). Replaces native <select> so the
 * popup follows the --ob-* theme variables instead of the OS highlight color.
 *
 * Focus stays on the trigger button; the highlighted option is exposed via aria-activedescendant.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import './select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Id for the trigger, so a <label htmlFor> can name it. */
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  /** Differing values across a multi-selection: shows `mixedLabel` until the user picks something. */
  mixed?: boolean;
  mixedLabel?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const TYPEAHEAD_RESET_MS = 600;
const POPUP_MAX_HEIGHT = 240;
const GAP = 2;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

export function Select(props: SelectProps) {
  const { value, options, onChange, disabled = false, mixed = false, mixedLabel = 'Mixed' } = props;
  const autoId = useId();
  const id = props.id ?? `${autoId}-btn`;
  const listId = `${autoId}-list`;
  const optId = (i: number): string => `${autoId}-opt-${i}`;
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Placement | undefined>();

  const selectedIndex = mixed ? -1 : options.findIndex((o) => o.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const shown = mixed ? mixedLabel : (current?.label ?? value);

  const openList = useCallback((at?: number): void => {
    if (disabled || options.length === 0) return;
    setActive(at ?? Math.max(0, selectedIndex));
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  const close = useCallback((refocus: boolean): void => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const choose = (i: number): void => {
    const o = options[i];
    close(true);
    if (o && (mixed || o.value !== value)) onChange(o.value);
  };

  // Position below the trigger; flip above when there is no room.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const want = Math.min(POPUP_MAX_HEIGHT, (listRef.current?.scrollHeight ?? POPUP_MAX_HEIGHT) + 2);
    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const up = below < want && above > below;
    const maxHeight = Math.max(80, Math.min(POPUP_MAX_HEIGHT, up ? above : below));
    setPlace({ top: up ? r.top - GAP : r.bottom + GAP, left: r.left, width: r.width, maxHeight, up });
  }, [open, options]);

  // Click outside / scroll / resize close the popup.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && (btnRef.current?.contains(t) || listRef.current?.contains(t))) return;
      setOpen(false);
    };
    const onScroll = (e: Event): void => {
      if (listRef.current?.contains(e.target as Node | null)) return;
      setOpen(false);
    };
    const onResize = (): void => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Keep the highlighted option visible.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, place]);

  const typeAhead = (ch: string): void => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPEAHEAD_RESET_MS ? ch : t.text + ch;
    t.at = now;
    const q = t.text.toLowerCase();
    const from = t.text.length === 1 ? (open ? active : selectedIndex) + 1 : open ? active : Math.max(0, selectedIndex);
    for (let n = 0; n < options.length; n++) {
      const i = (from + n) % options.length;
      if (options[i]!.label.toLowerCase().startsWith(q)) {
        if (open) setActive(i);
        else openList(i);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') {
      if (e.key === 'Tab' && open) setOpen(false);
      return;
    }
    const last = options.length - 1;
    let handled = true;
    if (!open) {
      switch (e.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
          openList();
          break;
        case 'ArrowUp':
          openList(Math.max(0, selectedIndex));
          break;
        case 'Home':
          openList(0);
          break;
        case 'End':
          openList(last);
          break;
        case 'Escape':
          return; // let the surrounding dialog/tool handle it
        default:
          if (e.key.length === 1) typeAhead(e.key);
      }
    } else {
      switch (e.key) {
        case 'ArrowDown':
          setActive((a) => Math.min(last, a + 1));
          break;
        case 'ArrowUp':
          setActive((a) => Math.max(0, a - 1));
          break;
        case 'Home':
          setActive(0);
          break;
        case 'End':
          setActive(last);
          break;
        case 'Enter':
        case ' ':
          choose(active);
          break;
        case 'Escape':
          close(true);
          break;
        default:
          if (e.key.length === 1) typeAhead(e.key);
          else handled = false;
      }
    }
    // Keys used here must not reach the global tool shortcuts / nudge handlers.
    e.stopPropagation();
    if (handled) e.preventDefault();
  };

  return (
    <span className={`ob-select${props.className ? ` ${props.className}` : ''}`}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        className="ob-select-button"
        data-mixed={mixed ? 'true' : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optId(active) : undefined}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-invalid={props['aria-invalid']}
        aria-describedby={props['aria-describedby']}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="ob-select-value">{shown}</span>
        <svg className="ob-select-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="ob-select-list"
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-label'] ? undefined : (props['aria-labelledby'] ?? id)}
          style={
            place
              ? { top: place.up ? undefined : place.top, bottom: place.up ? window.innerHeight - place.top : undefined, left: place.left, minWidth: place.width, maxHeight: place.maxHeight }
              : { visibility: 'hidden' }
          }
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              className={`ob-select-option${i === active ? ' is-active' : ''}${i === selectedIndex ? ' is-selected' : ''}`}
              onPointerEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault() /* keep focus on the trigger */}
              onClick={() => choose(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
