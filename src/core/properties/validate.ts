import { maxCornerRadius, round2, type ElementType } from '../model';
import { PROPERTY_DESCRIPTORS } from './descriptors';

export interface ValidationContext {
  /** Element size, needed for the corner radius upper bound. */
  width?: number;
  height?: number;
}

export type ValidationResult =
  | { ok: true; value: number | string }
  | { ok: false; error: string };

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const TOKEN_REF = /^token:[A-Za-z0-9._-]{1,64}$/;

export function validateProperty(
  elementType: ElementType,
  name: string,
  value: unknown,
  context: ValidationContext = {},
): ValidationResult {
  const d = Object.prototype.hasOwnProperty.call(PROPERTY_DESCRIPTORS, name)
    ? PROPERTY_DESCRIPTORS[name]
    : undefined;
  if (!d) return { ok: false, error: `Unknown property "${name}"` };
  if (d.appliesTo && !d.appliesTo.includes(elementType)) {
    return { ok: false, error: `Property "${name}" does not apply to ${elementType}` };
  }

  switch (d.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `"${name}" must be a finite number` };
      }
      const min = d.range?.min ?? -Infinity;
      let max = d.range?.max ?? Infinity;
      if (d.maxFromShorterSide) {
        if (typeof context.width !== 'number' || typeof context.height !== 'number') {
          return { ok: false, error: `"${name}" requires element width and height` };
        }
        max = maxCornerRadius(context.width, context.height);
      }
      if (value < min || value > max) {
        const upper = Number.isFinite(max) ? String(max) : 'unbounded';
        return { ok: false, error: `"${name}" must be between ${min} and ${upper}` };
      }
      return { ok: true, value: d.precision === 2 ? round2(value) : value };
    }
    case 'corners': {
      if (!Array.isArray(value) || value.length !== 4) {
        return { ok: false, error: `"${name}" must be an array of exactly four numbers` };
      }
      for (const v of value as unknown[]) {
        const r = validateProperty(elementType, 'cornerRadius', v, context);
        if (!r.ok) return { ok: false, error: r.error.replace('"cornerRadius"', `"${name}"`) };
      }
      // Array values are validated element-wise; the caller keeps its own array.
      return { ok: true, value: JSON.stringify(value) };
    }
    case 'enum': {
      if (typeof value !== 'string' || !d.values?.includes(value)) {
        return { ok: false, error: `"${name}" must be one of: ${d.values?.join(', ')}` };
      }
      return { ok: true, value };
    }
    case 'color': {
      if (
        typeof value !== 'string' ||
        (value !== 'theme:default' && !HEX_COLOR.test(value) && !TOKEN_REF.test(value))
      ) {
        return { ok: false, error: `"${name}" must be "theme:default", a hex color, or a token reference` };
      }
      return { ok: true, value };
    }
  }
}
