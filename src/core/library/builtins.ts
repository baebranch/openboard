/** Built-in library components (Req 6.14-6.16). Always available; never stored in the board file. */
import type { Element, ElementStyle, LibraryComponent } from '../model/types';

const style = (over: Partial<ElementStyle> = {}): ElementStyle => ({
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 1,
  cornerRadius: 0,
  ...over,
});

const box = (id: string, x: number, y: number, width: number, height: number, cornerRadius = 0): Element => ({
  id,
  type: 'rectangle',
  x,
  y,
  width,
  height,
  rotation: 0,
  style: style({ cornerRadius }),
});

const label = (id: string, x: number, y: number, width: number, height: number, text: string, align: 'left' | 'center' = 'center'): Element => ({
  id,
  type: 'text',
  x,
  y,
  width,
  height,
  rotation: 0,
  style: style({ strokeWidth: 0 }),
  runs: [{ text }],
  fontFamily: 'sans-serif',
  fontSize: 16,
  align,
});

export const BUILTIN_COMPONENTS: readonly LibraryComponent[] = [
  {
    id: 'builtin:button',
    name: 'button',
    builtin: true,
    elements: [box('b1', 0, 0, 120, 40, 8), label('b2', 0, 8, 120, 24, 'Button')],
  },
  {
    id: 'builtin:input-field',
    name: 'input field',
    builtin: true,
    elements: [box('i1', 0, 0, 240, 40, 4), label('i2', 8, 8, 224, 24, 'Placeholder', 'left')],
  },
  {
    id: 'builtin:card',
    name: 'card',
    builtin: true,
    elements: [box('c1', 0, 0, 280, 200, 12), label('c2', 16, 16, 248, 24, 'Card title', 'left'), label('c3', 16, 56, 248, 24, 'Card content', 'left')],
  },
  {
    id: 'builtin:navigation-bar',
    name: 'navigation bar',
    builtin: true,
    elements: [
      box('n1', 0, 0, 640, 56),
      label('n2', 16, 16, 100, 24, 'Logo', 'left'),
      label('n3', 400, 16, 60, 24, 'Home'),
      label('n4', 480, 16, 60, 24, 'About'),
      label('n5', 560, 16, 60, 24, 'Contact'),
    ],
  },
  {
    id: 'builtin:device-outline',
    name: 'device outline',
    builtin: true,
    elements: [box('d1', 0, 0, 390, 780, 40), box('d2', 16, 56, 358, 668, 0), box('d3', 155, 20, 80, 16, 8)],
  },
];

export interface ComponentLookup {
  component?: LibraryComponent;
  /** `not_found` or `ambiguous` when no single component matched. */
  error?: { code: 'not_found' | 'ambiguous'; message: string };
}

/** Resolves a component by id, else by name, across the built-ins and the document library. */
export function findComponent(library: readonly LibraryComponent[], key: string): ComponentLookup {
  const all = [...BUILTIN_COMPONENTS, ...library];
  const byId = all.filter((c) => c.id === key);
  const found = byId.length > 0 ? byId : all.filter((c) => c.name === key);
  if (found.length === 0) return { error: { code: 'not_found', message: `Library component not found: ${key}` } };
  if (found.length > 1) {
    return { error: { code: 'ambiguous', message: `Several library components are named "${key}"; use the id.` } };
  }
  return { component: found[0]! };
}
