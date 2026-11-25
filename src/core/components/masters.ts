/** Read-only selector behind the component panel (Req 13.6). Mirrors `openboard.component.list`. */
import type { BoardDocument, ElementId } from '../model/types';

export interface MasterEntry {
  id: ElementId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every Component_Master in ascending order by name (ties by id). */
export function listMasters(doc: Pick<BoardDocument, 'elements'>): MasterEntry[] {
  const out: MasterEntry[] = [];
  for (const e of doc.elements) {
    if (e.type === 'frame' && e.component !== undefined) {
      out.push({ id: e.id, name: e.component, x: e.x, y: e.y, width: e.width, height: e.height });
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
