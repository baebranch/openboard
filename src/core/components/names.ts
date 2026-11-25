/** Component_Master name rules (Req 13.1, 13.3, 13.9, 13.14). Pure: no I/O. */
import { COMPONENT_NAME_MAX } from './types';

export type ComponentNameCheck =
  | { ok: true; name: string }
  | { ok: false; code: 'invalid_name' | 'duplicate_name'; message: string };

/**
 * Trims `raw` and checks length (1 to 100 characters) and, when `existing` is given, that the
 * trimmed name is not already used by comparing case-sensitively.
 */
export function validateComponentName(raw: unknown, existing: Iterable<string> = []): ComponentNameCheck {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'invalid_name', message: 'A component name must be a string.' };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, code: 'invalid_name', message: 'A component name must not be empty.' };
  }
  if (name.length > COMPONENT_NAME_MAX) {
    return {
      ok: false,
      code: 'invalid_name',
      message: `A component name must be at most ${COMPONENT_NAME_MAX} characters.`,
    };
  }
  for (const n of existing) {
    if (n === name) {
      return { ok: false, code: 'duplicate_name', message: `The component name "${name}" is already in use.` };
    }
  }
  return { ok: true, name };
}

/**
 * Returns `base` when unused; otherwise appends a space and the smallest integer >= 2 that makes the
 * name unique, truncating `base` as needed to stay within 100 characters (Req 13.9).
 */
export function uniqueComponentName(base: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, COMPONENT_NAME_MAX - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}
