import type { ZOrderMode } from './types';

/**
 * Reorder a back-to-front list of ids. Selected ids keep their relative order.
 * `forward` / `backward` move each selected id by one position, stopping at the
 * edge or at another selected id. Returns a new array; ids not in `order` are ignored.
 */
export function reorderIds(order: readonly string[], selected: Iterable<string>, mode: ZOrderMode): string[] {
  const sel = new Set(selected);
  const result = [...order];
  const n = result.length;
  const isSel = (id: string | undefined): boolean => id !== undefined && sel.has(id);

  switch (mode) {
    case 'front':
      return [...order.filter((id) => !sel.has(id)), ...order.filter((id) => sel.has(id))];
    case 'back':
      return [...order.filter((id) => sel.has(id)), ...order.filter((id) => !sel.has(id))];
    case 'forward':
      for (let i = n - 2; i >= 0; i--) {
        if (isSel(result[i]) && !isSel(result[i + 1])) swap(result, i, i + 1);
      }
      return result;
    case 'backward':
      for (let i = 1; i < n; i++) {
        if (isSel(result[i]) && !isSel(result[i - 1])) swap(result, i, i - 1);
      }
      return result;
  }
}

/** Reorder elements (or anything with an `id`) in the same way as `reorderIds`. */
export function reorderElements<T extends { id: string }>(
  elements: readonly T[],
  selected: Iterable<string>,
  mode: ZOrderMode,
): T[] {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  return reorderIds(
    elements.map((e) => e.id),
    selected,
    mode,
  ).map((id) => byId.get(id) as T);
}

function swap<T>(arr: T[], i: number, j: number): void {
  const t = arr[i] as T;
  arr[i] = arr[j] as T;
  arr[j] = t;
}
