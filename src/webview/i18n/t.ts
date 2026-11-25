import * as l10n from '@vscode/l10n';
import bundleJson from '../../../l10n/bundle.l10n.json';

/**
 * Webview string lookup backed by `@vscode/l10n`. The bundle is the same l10n/bundle.l10n.json the
 * manifest references, embedded at build time (the webview cannot read the filesystem). Missing
 * keys fall back to the key text; `{0}`, `{1}`… placeholders are replaced by args.
 */

/** Configure the l10n runtime with the given bundle contents. */
export function setBundle(next: Record<string, string>): void {
  l10n.config({ contents: next });
}

/** Configure the runtime with the embedded bundle (called once from main.tsx). */
export function initL10n(): void {
  setBundle(bundleJson as Record<string, string>);
}

// Seed on module load so `t()` works even when imported without main.tsx (tests, other entries).
initL10n();

export function t(key: string, ...args: Array<string | number | boolean>): string {
  return l10n.t(key, ...args);
}
