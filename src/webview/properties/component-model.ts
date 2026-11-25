/**
 * Pure logic for the component controls of the Properties_Panel (Req 13.5, 14.9, 14.11, 14.18,
 * 14.19, 26.9): which component role the selection has, the name / detach / reset / go-to-master
 * actions, and which fields carry an Override indicator. No React here.
 */
import { validateComponentName } from '../../core/components/names';
import type { Element, FrameElement } from '../../core/model';
import { t } from '../i18n/t';

/** An op posted through `dispatchOp`; unlike `UpdateOp` the tool varies. */
export interface ComponentOp {
  tool: string;
  input: Record<string, unknown>;
}

export type ComponentCommit = { ok: true; op: ComponentOp } | { ok: false; error: string };

export type ComponentContext =
  | { kind: 'master'; master: FrameElement }
  | { kind: 'instance'; instance: FrameElement; master: FrameElement | undefined }
  | { kind: 'instance-child'; owner: FrameElement; key: string };

const SEP = '::';

const isFrame = (el: Element | undefined): el is FrameElement => el !== undefined && el.type === 'frame';

/** Role of the selection: only a single selected Frame or Instance_Child has component controls. */
export function componentContext(selected: readonly Element[], all: readonly Element[]): ComponentContext | undefined {
  if (selected.length !== 1) return undefined;
  const el = selected[0]!;
  const byId = new Map(all.map((e) => [e.id, e]));
  const at = el.id.lastIndexOf(SEP);
  if (at > 0 && at + SEP.length < el.id.length) {
    const owner = byId.get(el.id.slice(0, at));
    if (isFrame(owner) && owner.instanceOf !== undefined) return { kind: 'instance-child', owner, key: el.id.slice(at + SEP.length) };
  }
  if (!isFrame(el)) return undefined;
  if (el.instanceOf !== undefined) {
    const m = byId.get(el.instanceOf);
    return { kind: 'instance', instance: el, master: isFrame(m) && m.component !== undefined ? m : undefined };
  }
  if (el.component !== undefined) return { kind: 'master', master: el };
  return undefined;
}

/** True when the instance references no existing Component_Master (Req 14.11). */
export const isMasterMissing = (ctx: ComponentContext): boolean => ctx.kind === 'instance' && ctx.master === undefined;

function nameError(code: 'invalid_name' | 'duplicate_name', name: string, raw: string): string {
  if (code === 'duplicate_name') return t('The component name "{0}" is already in use', name);
  return raw.trim().length === 0 ? t('A component name must not be empty') : t('A component name must be at most 100 characters');
}

/**
 * Rename a master (Req 13.5). The trimmed name must be 1 to 100 characters and unique among the
 * other masters, case-sensitively. Callers skip the commit when the name is unchanged.
 */
export function buildRenameOp(master: FrameElement, raw: string, all: readonly Element[]): ComponentCommit {
  const others: string[] = [];
  for (const e of all) if (isFrame(e) && e.component !== undefined && e.id !== master.id) others.push(e.component);
  const check = validateComponentName(raw, others);
  if (!check.ok) return { ok: false, error: nameError(check.code, raw.trim(), raw) };
  return { ok: true, op: { tool: 'openboard.element.update', input: { ids: [master.id], set: { component: check.name } } } };
}

/** "Detach Instance": one undo entry via `openboard.component.instance.detach`. */
export function buildDetachInstanceOp(instance: FrameElement): ComponentOp {
  return { tool: 'openboard.component.instance.detach', input: { id: instance.id } };
}

/** Overrides stored for the selection (the instance root, or one Instance_Child). */
function storedOverrides(ctx: ComponentContext): Record<string, unknown> {
  if (ctx.kind === 'instance') return (ctx.instance.overrides?.[''] ?? {}) as Record<string, unknown>;
  if (ctx.kind === 'instance-child') return (ctx.owner.overrides?.[ctx.key] ?? {}) as Record<string, unknown>;
  return {};
}

/** Names of the overridden properties of the selected instance or Instance_Child (Req 14.9). */
export function overriddenProperties(ctx: ComponentContext | undefined): ReadonlySet<string> {
  return new Set(ctx ? Object.keys(storedOverrides(ctx)) : []);
}

/** Whether the selected instance (or any of its children) has an Override to reset (Req 14.8). */
export function hasOverrides(ctx: ComponentContext | undefined): boolean {
  if (!ctx) return false;
  if (ctx.kind === 'instance') return Object.values(ctx.instance.overrides ?? {}).some((o) => Object.keys(o).length > 0);
  return Object.keys(storedOverrides(ctx)).length > 0;
}

/** "Reset Overrides" for the whole instance / Instance_Child, or for one property of it. */
export function buildResetOverridesOp(ctx: ComponentContext, elementId: string, property?: string): ComponentOp | undefined {
  if (ctx.kind === 'master') return undefined;
  return { tool: 'openboard.component.instance.override.reset', input: { id: elementId, ...(property !== undefined ? { property } : {}) } };
}

/** Id of the master that "Go to master" selects, when it exists (Req 14.19). */
export function goToMasterTarget(ctx: ComponentContext | undefined): string | undefined {
  if (!ctx) return undefined;
  if (ctx.kind === 'instance') return ctx.master?.id;
  if (ctx.kind === 'master') return ctx.master.id;
  return undefined;
}
