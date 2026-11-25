/**
 * Installed font families for the font picker. The host scans the system font folders on request
 * (`fonts:request` -> `fonts`); the list is fetched once per webview and cached. Until it arrives
 * (or outside a webview) only the generic CSS families are offered.
 */
import { useSyncExternalStore } from 'react';

/** CSS generic families: always available, listed first. */
export const GENERIC_FONT_FAMILIES: readonly string[] = ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive'];

let families: readonly string[] | undefined;
let requested = false;
let sender: (() => void) | undefined;
const listeners = new Set<() => void>();

/** Wired by main.tsx: asks the host for the installed fonts. */
export function setFontRequestSender(send: (() => void) | undefined): void {
  sender = send;
}

/** Ask the host for the font list once; later calls are no-ops. */
export function requestFonts(): void {
  if (requested || !sender) return;
  requested = true;
  sender();
}

/** Called by messaging when the host replies. */
export function receiveFonts(list: readonly string[]): void {
  families = [...list];
  for (const l of [...listeners]) l();
}

/** Test hook: forget the cached list and request state. */
export function resetFonts(): void {
  families = undefined;
  requested = false;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Installed families, or undefined while they have not arrived. */
export function useInstalledFonts(): readonly string[] | undefined {
  return useSyncExternalStore(subscribe, () => families, () => families);
}

/** Max results the picker renders at once; typing narrows the list. */
export const FONT_RESULT_LIMIT = 200;

/**
 * Picker results for `query`: generic families, then installed ones, deduplicated
 * case-insensitively. Families containing the query (case-insensitive) match; those starting
 * with it sort first. An empty query lists everything up to the limit.
 */
export function searchFonts(installed: readonly string[] | undefined, query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const all: string[] = [];
  for (const f of [...GENERIC_FONT_FAMILIES, ...(installed ?? [])]) {
    const k = f.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(f);
  }
  if (q === '') return all.slice(0, FONT_RESULT_LIMIT);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const f of all) {
    const k = f.toLowerCase();
    if (k.startsWith(q)) starts.push(f);
    else if (k.includes(q)) contains.push(f);
  }
  return [...starts, ...contains].slice(0, FONT_RESULT_LIMIT);
}

/** CSS `font-family` value that previews `family` (generic names stay unquoted). */
export function fontPreview(family: string): string {
  if (GENERIC_FONT_FAMILIES.includes(family)) return family;
  return `"${family.replace(/["\\]/g, '')}", sans-serif`;
}
