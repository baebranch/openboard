/**
 * Small 24x24 stroke icons for the Properties_Panel: input prefixes, icon segmented controls, and
 * section chrome. Drawn with `currentColor` so they follow the theme (including high contrast).
 * Always decorative: the control that shows one carries the accessible name.
 */
import type { ReactElement } from 'react';

const PATHS: Record<string, ReactElement> = {
  // Input prefixes.
  rotation: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />,
  strokeWidth: (
    <>
      <path d="M4 6h16" strokeWidth={1} />
      <path d="M4 12h16" strokeWidth={2} />
      <path d="M4 18h16" strokeWidth={3.5} />
    </>
  ),
  opacity: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  cornerRadius: <path d="M5 19V11a6 6 0 0 1 6-6h8" />,
  fontSize: <path d="M4 18L9 6l5 12M5.7 14h6.6M15 18l3-7 3 7M16 16h4" />,
  gap: <path d="M5 4v16M19 4v16M9 12h6M9 12l2-2M9 12l2 2M15 12l-2-2M15 12l-2 2" />,
  padTop: <path d="M4 4h16M8 9h8v11H8z" />,
  padRight: <path d="M20 4v16M4 8h11v8H4z" />,
  padBottom: <path d="M4 20h16M8 4h8v11H8z" />,
  padLeft: <path d="M4 4v16M9 8h11v8H9z" />,
  cornerAll: <path d="M4 10V7a3 3 0 0 1 3-3h3M14 4h3a3 3 0 0 1 3 3v3M20 14v3a3 3 0 0 1-3 3h-3M10 20H7a3 3 0 0 1-3-3v-3" />,
  corner0: <path d="M6 20V11a5 5 0 0 1 5-5h9" />,
  corner1: <path d="M4 6h9a5 5 0 0 1 5 5v9" />,
  corner2: <path d="M18 4v9a5 5 0 0 1-5 5H4" />,
  corner3: <path d="M20 18h-9a5 5 0 0 1-5-5V4" />,

  // Text alignment.
  'align:left': <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  'align:center': <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  'align:right': <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  // Text wrap.
  'textWrap:none': <path d="M4 12h13M14 9l3 3-3 3M20 6v12" />,
  'textWrap:wrap': <path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5" />,
  // Stroke style.
  'strokeStyle:solid': <path d="M4 12h16" />,
  'strokeStyle:dashed': <path d="M3 12h4M10 12h4M17 12h4" />,
  'strokeStyle:dotted': <path d="M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01" strokeWidth={3} />,
  // Connector routing.
  'routing:straight': <path d="M5 19L19 5M5 19h.01M19 5h.01" />,
  'routing:curved': <path d="M5 19C5 9 19 15 19 5" />,
  'routing:orthogonal': <path d="M5 19v-7h14V5" />,
  // Auto Layout direction.
  'direction:horizontal': <path d="M4 12h16M16 8l4 4-4 4" />,
  'direction:vertical': <path d="M12 4v16M8 16l4 4 4-4" />,
  // Main-axis alignment (drawn along a horizontal main axis).
  'mainAlign:start': <path d="M4 4v16M8 8h4v8H8zM14 8h3v8h-3z" />,
  'mainAlign:center': <path d="M12 4v16M6 8h4v8H6zM14 8h4v8h-4z" />,
  'mainAlign:end': <path d="M20 4v16M7 8h3v8H7zM12 8h4v8h-4z" />,
  'mainAlign:spaceBetween': <path d="M3 4v16M21 4v16M6 8h3v8H6zM15 8h3v8h-3z" />,
  // Cross-axis alignment.
  'crossAlign:start': <path d="M4 4h16M7 7h4v10H7zM13 7h4v6h-4z" />,
  'crossAlign:center': <path d="M4 12h16M7 6h4v12H7zM13 9h4v6h-4z" />,
  'crossAlign:end': <path d="M4 20h16M7 7h4v10H7zM13 11h4v6h-4z" />,

  // Section chrome.
  chevron: <path d="M6 9l6 6 6-6" />,
};

/** True when `name` has an icon (unknown enum values fall back to a text label). */
export function hasPanelIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

export function PanelIcon({ name, size = 16 }: { name: string; size?: number }) {
  const shape = PATHS[name];
  if (!shape) return null;
  return (
    <svg
      className="ob-panel-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}
