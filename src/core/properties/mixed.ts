/**
 * Mixed-value summary for the Properties_Panel (Req 6.8): when the selected
 * elements disagree on a property the panel shows "mixed", otherwise the
 * common value.
 */
export interface PropertySummary {
  readonly mixed: boolean;
  /** Common value; absent when mixed or when there are no elements / no value. */
  readonly value?: unknown;
}

function readProperty(element: object, name: string): unknown {
  const e = element as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(e, name)) return e[name];
  const style = e.style;
  if (style !== null && typeof style === 'object') return (style as Record<string, unknown>)[name];
  return undefined;
}

export function summarizeProperty(elements: readonly object[], name: string): PropertySummary {
  if (elements.length === 0) return { mixed: false };
  const first = readProperty(elements[0]!, name);
  for (let i = 1; i < elements.length; i++) {
    if (!Object.is(readProperty(elements[i]!, name), first)) return { mixed: true };
  }
  return first === undefined ? { mixed: false } : { mixed: false, value: first };
}
