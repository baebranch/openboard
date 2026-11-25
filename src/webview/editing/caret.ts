import { measure } from '../../core/text';

/** Maps DOM selection positions in the restricted editor (text + <br>) to run character offsets. */

/** Marker attribute for a <br> that shows a Renderer line break but is not part of the text. */
export const SOFT_BREAK_ATTR = 'data-soft';

function isSoftBreak(n: Node): boolean {
  return n.nodeName === 'BR' && (n as Element).hasAttribute?.(SOFT_BREAK_ATTR) === true;
}

/** Text padding the Renderer uses per element type (see renderText callers in svg.ts). */
export function textPadding(type: string): number {
  return type === 'sticky' ? 8 : type === 'flowNode' ? 4 : 0;
}

export interface WrapSpec {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  /** Element width minus twice the text padding, as the Renderer uses. */
  width: number;
}

/**
 * Character offsets (UTF-16, newline = 1) before which the Renderer starts a wrapped line.
 * Uses the same measure() call and whitespace mapping as the Renderer, so the overlay breaks
 * at the same positions. Whitespace at a break stays at the end of the previous line.
 */
export function softBreakOffsets(text: string, spec: WrapSpec): number[] {
  const breaks: number[] = [];
  let base = 0;
  for (const para of text.split(/\r\n|\r|\n/)) {
    const out = measure({ text: para, fontFamily: spec.fontFamily, fontSize: spec.fontSize, fontWeight: spec.fontWeight, availableWidth: spec.width });
    if (out.ok) {
      const chars: { ch: string; at: number }[] = [];
      let at = 0;
      for (const ch of Array.from(para)) {
        chars.push({ ch, at });
        at += ch.length;
      }
      let p = 0;
      out.value.lines.forEach((line, i) => {
        while (p < chars.length && /\s/.test(chars[p]!.ch)) p++;
        if (i > 0 && p < chars.length) breaks.push(base + chars[p]!.at);
        for (const lc of Array.from(line)) {
          if (/\s/.test(lc)) while (p < chars.length && /\s/.test(chars[p]!.ch)) p++;
          else p++;
        }
      });
    }
    // The editor text only ever uses '\n' (a <br> maps to one newline).
    base += para.length + 1;
  }
  return breaks;
}

/**
 * Re-inserts soft <br> markers into `root` at the given offsets. Existing soft breaks must have been
 * removed first. Offsets are applied from the end so earlier ones stay valid.
 */
export function insertSoftBreaks(root: Node, offsets: readonly number[]): void {
  for (const off of [...offsets].sort((a, b) => b - a)) {
    const pos = positionAt(root, off);
    const range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    const br = document.createElement('br');
    br.setAttribute(SOFT_BREAK_ATTR, '');
    range.insertNode(br);
  }
}

/** Removes soft breaks and merges the text nodes they separated. */
export function removeSoftBreaks(root: Element): void {
  root.querySelectorAll(`br[${SOFT_BREAK_ATTR}]`).forEach((b) => b.remove());
  root.normalize();
}

/** Editor markup without the soft-break markers, for htmlToRuns. */
export function cleanHtml(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(`br[${SOFT_BREAK_ATTR}]`).forEach((b) => b.remove());
  return clone.innerHTML;
}

function walk(root: Node, visit: (n: Node) => boolean): void {
  const rec = (n: Node): boolean => {
    for (const c of Array.from(n.childNodes)) {
      if (visit(c)) return true;
      if (rec(c)) return true;
    }
    return false;
  };
  rec(root);
}

/** Character offset of (node, offset) within `root`; <br> counts as one newline. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const target = node.nodeType === Node.TEXT_NODE ? node : node.childNodes[offset];
  const rec = (n: Node): void => {
    for (const c of Array.from(n.childNodes)) {
      if (found) return;
      if (c === target && node.nodeType !== Node.TEXT_NODE) {
        found = true;
        return;
      }
      if (c.nodeType === Node.TEXT_NODE) {
        const len = (c.textContent ?? '').length;
        if (c === node) {
          total += offset;
          found = true;
          return;
        }
        total += len;
      } else if (c.nodeName === 'BR') {
        if (!isSoftBreak(c)) total += 1;
      } else rec(c);
    }
  };
  rec(root);
  return total;
}

/** DOM position for a character offset (end of root when past the end). */
export function positionAt(root: Node, offset: number): { node: Node; offset: number } {
  let left = offset;
  let result: { node: Node; offset: number } | undefined;
  walk(root, (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? '').length;
      if (left <= len) {
        result = { node: n, offset: left };
        return true;
      }
      left -= len;
    } else if (n.nodeName === 'BR') {
      if (isSoftBreak(n)) return false;
      if (left === 0) {
        const parent = n.parentNode as Node;
        result = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) as number };
        return true;
      }
      left -= 1;
    }
    return false;
  });
  return result ?? { node: root, offset: root.childNodes.length };
}
