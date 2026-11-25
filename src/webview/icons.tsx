/**
 * Inline 24x24 stroke icons for the palette and export buttons. Drawn with `currentColor`, so they
 * follow the theme (including high contrast). Decorative only: buttons carry aria-label + title.
 */
import type { ReactElement } from 'react';
import type { ToolId } from './uiState';

export type IconName = ToolId | 'export' | 'copyImage';

const PATHS: Record<IconName, ReactElement> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  hand: (
    <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-.5a6 6 0 01-5-2.7L3.6 14a1.5 1.5 0 012.4-1.8L8 15" />
  ),
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  line: <path d="M5 19L19 5" />,
  arrow: <path d="M5 19L19 5m0 0h-8m8 0v8" />,
  freehand: <path d="M3 17c3-6 5-9 7-7s-2 7 1 7 4-9 6-9 2 4 4 4" />,
  text: <path d="M5 6V4h14v2M12 4v16m-3 0h6" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  frame: <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />,
  sticky: <path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />,
  eraser: <path d="M8 20h12M5.5 14.5l8-8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H9z" />,
  export: <path d="M12 15V3m0 0L7 8m5-5l5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />,
  copyImage: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="1.5" />
      <path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3" />
      <path d="M21 18l-4-4-6 6" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ob-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
