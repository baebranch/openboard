import type { BoardValidator } from '../../core/format/parser';
import type { MessageValidators } from '../../shared/messages';

export type LoadedValidators = MessageValidators & { validateBoard: BoardValidator };

/**
 * Loads the compiled validators built by scripts/build-schemas.mjs (dist/validators.js).
 * `requireFn` is injectable; the host passes Node's `require`.
 */
export function loadValidators(file: string, requireFn: (id: string) => unknown): LoadedValidators {
  const mod = requireFn(file) as Partial<Record<keyof LoadedValidators, unknown>> | null;
  for (const k of ['validateBoard', 'validateWebviewToHost', 'validateHostToWebview'] as const) {
    if (typeof mod?.[k] !== 'function') throw new Error(`dist/validators.js is missing ${k}; run npm run build:schemas`);
  }
  return mod as LoadedValidators;
}
