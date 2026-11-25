/**
 * Component remapping for copy, paste, duplicate, and library/PNG insertion (Req 13.9, 14.14, 14.15).
 * Pure: no vscode, DOM, or I/O.
 */
import type { Element, ElementId } from '../model/types';
import { uniqueComponentName } from './names';

const SEP = '::';

export interface ComponentClonePlan {
  /** Source ids that are Instance_Children of a linked instance; the Sync_Pass regenerates them. */
  skip: Set<ElementId>;
  /** Instances (and nested former Instance_Children) that become ordinary Frames. */
  detach: Set<ElementId>;
  /** New unique names for copied masters, keyed by source master id. */
  names: Map<ElementId, string>;
  /** Source master ids that are copied together with the source set. */
  copiedMasters: Set<ElementId>;
}

/**
 * Decides how each component-related source element is cloned into `existing` (the target document).
 * An instance whose master is in the source, or already a master in `existing`, stays linked.
 */
export function planComponentClone(source: readonly Element[], existing: readonly Element[]): ComponentClonePlan {
  const copiedMasters = new Set<ElementId>();
  const existingMasters = new Set<ElementId>();
  const usedNames = new Set<string>();
  for (const e of existing) {
    if (e.type === 'frame' && e.component !== undefined) {
      existingMasters.add(e.id);
      usedNames.add(e.component);
    }
  }
  const names = new Map<ElementId, string>();
  for (const e of source) {
    if (e.type !== 'frame' || e.component === undefined) continue;
    copiedMasters.add(e.id);
    const name = uniqueComponentName(e.component, usedNames);
    usedNames.add(name);
    names.set(e.id, name);
  }

  const ids = new Set(source.map((e) => e.id));
  const isDerivedFromSourceInstance = (id: ElementId): ElementId | undefined => {
    const at = id.indexOf(SEP);
    if (at <= 0) return undefined;
    const owner = id.slice(0, at);
    return ids.has(owner) ? owner : undefined;
  };

  const skip = new Set<ElementId>();
  const detach = new Set<ElementId>();
  const instances = source.filter((e) => e.type === 'frame' && e.instanceOf !== undefined && isDerivedFromSourceInstance(e.id) === undefined);
  for (const inst of instances) {
    if (inst.type !== 'frame') continue;
    const linked = copiedMasters.has(inst.instanceOf as ElementId) || existingMasters.has(inst.instanceOf as ElementId);
    const prefix = inst.id + SEP;
    if (linked) {
      for (const e of source) if (e.id.startsWith(prefix)) skip.add(e.id);
    } else {
      detach.add(inst.id);
      for (const e of source) if (e.id.startsWith(prefix) && e.type === 'frame' && e.instanceOf !== undefined) detach.add(e.id);
    }
  }
  return { skip, detach, names, copiedMasters };
}

/**
 * Applies the plan to one cloned element record in place. `idMap` maps source ids to new ids and must
 * not contain skipped ids.
 */
export function remapComponentFields(
  copy: Record<string, unknown>,
  src: Element,
  plan: ComponentClonePlan,
  idMap: ReadonlyMap<ElementId, ElementId>,
): void {
  if (src.type !== 'frame') return;
  const name = plan.names.get(src.id);
  if (name !== undefined) copy['component'] = name;
  if (plan.detach.has(src.id)) {
    delete copy['instanceOf'];
    delete copy['overrides'];
  } else if (src.instanceOf !== undefined) {
    const mapped = idMap.get(src.instanceOf);
    if (mapped !== undefined && plan.copiedMasters.has(src.instanceOf)) copy['instanceOf'] = mapped;
  }
}
