/**
 * A row of icon buttons that picks one value of an enum: a radio group with roving focus (arrow
 * keys, Home, End). Replaces a dropdown for short enums such as text alignment or stroke style.
 * Each option's accessible name and tooltip is "<group label>: <option>"; options without an icon
 * show their text instead. A mixed selection checks no option and marks the group `data-mixed`.
 */
import { useRef, type KeyboardEvent } from 'react';
import { hasPanelIcon, PanelIcon } from '../properties/panel-icons';

export interface IconSegmentedProps {
  /** Group label; used for the accessible name of the group (when no `labelledBy`) and each option. */
  label: string;
  /** Id of a visible element that labels the group. */
  labelledBy?: string;
  values: readonly string[];
  /** Selected value; undefined for a mixed or empty selection. */
  value: string | undefined;
  /** Icon key for a value; defaults to the value itself. */
  iconFor?(value: string): string;
  /** Display name of a value; defaults to the value. */
  optionLabel?(value: string): string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  mixed?: boolean;
  onChange(value: string): void;
}

export function IconSegmented({
  label,
  labelledBy,
  values,
  value,
  iconFor = (v) => v,
  optionLabel = (v) => v,
  disabled = false,
  invalid = false,
  describedBy,
  mixed = false,
  onChange,
}: IconSegmentedProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = value === undefined ? -1 : values.indexOf(value);
  const tabbable = Math.max(0, selected);

  const choose = (v: string): void => {
    if (v !== value || mixed) onChange(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const last = values.length - 1;
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // keep arrow keys away from the canvas nudge shortcuts
    refs.current[next]?.focus();
    choose(values[next]!);
  };

  return (
    <div
      role="radiogroup"
      className="ob-segmented ob-segmented-icons"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      data-mixed={mixed ? 'true' : undefined}
    >
      {values.map((v, i) => {
        const name = `${label}: ${optionLabel(v)}`;
        const icon = iconFor(v);
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={!mixed && i === selected}
            aria-label={name}
            title={name}
            tabIndex={i === tabbable ? 0 : -1}
            disabled={disabled}
            data-value={v}
            onClick={() => choose(v)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {hasPanelIcon(icon) ? <PanelIcon name={icon} /> : optionLabel(v)}
          </button>
        );
      })}
    </div>
  );
}
