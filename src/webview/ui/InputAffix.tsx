/**
 * Draws a short prefix (text such as "W", or an icon) and an optional trailing slot inside one input
 * box. The prefix is decorative (`aria-hidden`): the input keeps its own label as accessible name.
 * Pressing the prefix focuses the input, so the whole box acts as one field.
 */
import type { ReactNode } from 'react';
import { PanelIcon } from '../properties/panel-icons';

export function InputAffix({
  prefix,
  icon,
  title,
  leading,
  trailing,
  children,
}: {
  prefix?: string;
  icon?: string;
  /** Tooltip on the prefix (usually the field's full label). */
  title?: string;
  /** Interactive leading content (a color swatch) drawn instead of a prefix. */
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ob-input-affix">
      {leading ??
        (prefix !== undefined || icon !== undefined ? (
          <span
            className="ob-input-prefix"
            aria-hidden="true"
            title={title}
            onMouseDown={(e) => {
              e.preventDefault();
              (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
            }}
          >
            {icon !== undefined ? <PanelIcon name={icon} size={14} /> : prefix}
          </span>
        ) : null)}
      {children}
      {trailing}
    </div>
  );
}
