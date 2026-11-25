/** Maps DOM selection positions in the restricted editor (text + <br>) to run character offsets. */

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
      } else if (c.nodeName === 'BR') total += 1;
      else rec(c);
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
