/**
 * `openboard.component.create | remove | list` (Req 13.1 to 13.4, 13.6, 13.7, 13.12 to 13.14, 25.3)
 * and `openboard.component.instance.create | override.set | override.reset | detach`
 * (Req 14.1, 14.4, 14.5, 14.8, 14.12, 14.13, 15.8, 15.9, 15.12, 25.3).
 * Every handler validates before it mutates and runs inside the transaction the registry opens, so
 * a call is one undo entry and a rejected call leaves the document and history unchanged.
 */
import { validateComponentName } from '../components/names';
import { ComponentCycleError, ComponentDepthError, syncPass } from '../components/sync';
import { OVERRIDABLE_PROPERTIES, ROOT_OVERRIDE_KEY, type Override } from '../components/types';
import { unionBounds } from '../model';
import type { Element, FrameElement } from '../model';
import type { Tx } from '../ops/model';
import { s } from '../schema/builder';
import { createFrame, frameNestingProblem } from '../shapes';
import type { DefaultToolRegistry, ToolDefinition } from './registry';
import { overrideValueError } from './element-tools';
import { ToolFailure } from './tool-failure';

const boardProp = () => s.opt(s.string({ minLength: 1 }));

function requireTx(tx: Tx | undefined): Tx {
  if (!tx) throw new ToolFailure('no_board', 'No board is available for this tool');
  return tx;
}

function masterNames(elements: readonly Element[]): string[] {
  const names: string[] = [];
  for (const el of elements) if (el.type === 'frame' && el.component !== undefined) names.push(el.component);
  return names;
}

/** Instance_Children carry derived ids of the form `<instanceId>::<masterChildId>`. */
function isInstanceChildId(id: string): boolean {
  const at = id.lastIndexOf('::');
  return at > 0 && at + 2 < id.length;
}

// --- create ------------------------------------------------------------------------------------

interface CreateInput {
  board?: string;
  ids: string[];
  name: string;
}

interface CreateOutput {
  id: string;
  name: string;
  /** True when a new Frame was created around a non-Frame selection. */
  wrapped: boolean;
}

const createTool: ToolDefinition<CreateInput, CreateOutput> = {
  name: 'openboard.component.create',
  description:
    'Create a component master. `ids` is one Frame (it becomes the master) or one or more non-Frame elements (they are wrapped in a new Frame at their union bounds, which becomes the master). `name` is 1 to 100 characters after trimming and unique among masters (case-sensitive). A component instance cannot be a master. One undo step.',
  inputSchema: s.object({
    board: boardProp(),
    ids: s.array(s.string({ minLength: 1 }), { minItems: 1, maxItems: 1000 }),
    name: s.string(),
  }),
  outputSchema: s.object({ id: s.string(), name: s.string(), wrapped: s.boolean() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const els = tx.doc.elements;
    const byId = new Map<string, Element>(els.map((e) => [e.id, e]));
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) throw new ToolFailure('invalid_selection', 'Select a Frame or elements to create a component.');
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new ToolFailure('not_found', `Element not found: ${missing.join(', ')}`);
    const picked = ids.map((id) => byId.get(id) as Element);

    const check = validateComponentName(input.name, masterNames(els));
    if (!check.ok) throw new ToolFailure(check.code, check.message);

    const frames = picked.filter((e) => e.type === 'frame') as FrameElement[];
    if (frames.length > 1) {
      throw new ToolFailure('invalid_selection', 'Select exactly one Frame, or select only non-Frame elements.');
    }
    if (frames.length === 1 && picked.length > 1) {
      throw new ToolFailure('invalid_selection', 'The selection mixes a Frame with other elements.');
    }
    const only = frames[0];
    if (only) {
      if (only.instanceOf !== undefined) {
        throw new ToolFailure('instance_cannot_be_master', 'A component instance cannot be a component master.');
      }
      if (only.component !== undefined) {
        throw new ToolFailure('already_component', `Frame ${only.id} is already a component master.`);
      }
      if (isInstanceChildId(only.id)) {
        throw new ToolFailure('instance_child', `Element ${only.id} belongs to a component instance; detach the instance first.`);
      }
      tx.update(only.id, { component: check.name });
      return { id: only.id, name: check.name, wrapped: false };
    }

    const inChild = picked.find((e) => isInstanceChildId(e.id));
    if (inChild) {
      throw new ToolFailure('instance_child', `Element ${inChild.id} belongs to a component instance; detach the instance first.`);
    }
    const bounds = unionBounds(picked);
    if (!bounds) throw new ToolFailure('invalid_selection', 'Select a Frame or elements to create a component.');
    const { frame } = createFrame(bounds, [], { name: check.name });
    const created = tx.create({ ...frame, component: check.name });
    // The new Frame must draw behind the elements it wraps.
    tx.reorder([created.id], 'back');
    for (const el of picked) tx.update(el.id, { parentId: created.id });
    return { id: created.id, name: check.name, wrapped: true };
  },
};

// --- remove ------------------------------------------------------------------------------------

interface RemoveInput {
  board?: string;
  id: string;
}

interface RemoveOutput {
  id: string;
  /** Component_Instances that were detached from the removed master. */
  detached: string[];
}

const removeTool: ToolDefinition<RemoveInput, RemoveOutput> = {
  name: 'openboard.component.remove',
  description:
    'Remove the component marker from one master Frame. The Frame and its descendants stay as an ordinary Frame, and every instance of that master is detached (it keeps its children, minus `instanceOf` and `overrides`). One undo step.',
  inputSchema: s.object({ board: boardProp(), id: s.string({ minLength: 1 }) }),
  outputSchema: s.object({ id: s.string(), detached: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const el = tx.doc.elements.find((e) => e.id === input.id);
    if (!el) throw new ToolFailure('not_found', `Element not found: ${input.id}`);
    if (el.type !== 'frame' || el.component === undefined) {
      throw new ToolFailure('not_a_component', `Element ${input.id} is not a component master.`);
    }
    const detached: string[] = [];
    for (const e of tx.doc.elements) {
      if (e.type === 'frame' && e.instanceOf === input.id && !isInstanceChildId(e.id)) detached.push(e.id);
    }
    for (const id of detached) tx.update(id, { instanceOf: undefined, overrides: undefined });
    tx.update(input.id, { component: undefined });
    return { id: input.id, detached };
  },
};

// --- list --------------------------------------------------------------------------------------

interface ComponentInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  instances: number;
}

const listTool: ToolDefinition<{ board?: string }, { components: ComponentInfo[] }> = {
  name: 'openboard.component.list',
  description: 'List component masters sorted by name, with their size and instance count. Read-only.',
  inputSchema: s.object({ board: boardProp() }),
  outputSchema: s.object({
    components: s.array(
      s.object({
        id: s.string(),
        name: s.string(),
        width: s.number(),
        height: s.number(),
        instances: s.integer({ min: 0 }),
      }),
    ),
  }),
  readOnly: true,
  async: true,
  boardResolution: 'required-or-active',
  handler(ctx) {
    if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
    const elements = ctx.model.getDocument().elements;
    const counts = new Map<string, number>();
    for (const e of elements) {
      if (e.type === 'frame' && e.instanceOf !== undefined && !isInstanceChildId(e.id)) {
        counts.set(e.instanceOf, (counts.get(e.instanceOf) ?? 0) + 1);
      }
    }
    const components: ComponentInfo[] = [];
    for (const e of elements) {
      if (e.type === 'frame' && e.component !== undefined) {
        components.push({ id: e.id, name: e.component, width: e.width, height: e.height, instances: counts.get(e.id) ?? 0 });
      }
    }
    components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { components };
  },
};

// --- instances ---------------------------------------------------------------------------------

/** Runs the Sync_Pass on the pending document so a cycle or depth violation is a clean tool error. */
function assertSyncable(tx: Tx): void {
  try {
    syncPass(tx.doc);
  } catch (err) {
    if (err instanceof ComponentCycleError) throw new ToolFailure('component_cycle', err.message);
    if (err instanceof ComponentDepthError) throw new ToolFailure('component_depth', err.message);
    throw err;
  }
}

function frameOf(tx: Tx, id: string): FrameElement | undefined {
  const el = tx.doc.elements.find((e) => e.id === id);
  return el && el.type === 'frame' ? el : undefined;
}

/**
 * Resolves the override target. With `childId` the `id` is the instance and `childId` is a master
 * child id (or `''` for the root). Without it, an Instance_Child id maps to its owning instance and
 * a plain instance id maps to the root.
 */
function resolveOverrideTarget(tx: Tx, id: string, childId: string | undefined): { owner: FrameElement; key: string } {
  const found = tx.doc.elements.find((e) => e.id === id);
  if (!found) throw new ToolFailure('not_found', `Element not found: ${id}`);
  if (childId !== undefined) {
    if (found.type !== 'frame' || found.instanceOf === undefined) {
      throw new ToolFailure('not_an_instance', `Element ${id} is not a component instance.`);
    }
    return { owner: found, key: childId };
  }
  if (isInstanceChildId(id)) {
    const at = id.lastIndexOf('::');
    const owner = frameOf(tx, id.slice(0, at));
    if (owner && owner.instanceOf !== undefined) return { owner, key: id.slice(at + 2) };
  }
  if (found.type === 'frame' && found.instanceOf !== undefined) return { owner: found, key: ROOT_OVERRIDE_KEY };
  throw new ToolFailure('not_an_instance', `Element ${id} is neither a component instance nor one of its instance children.`);
}

function requireKnownChild(tx: Tx, owner: FrameElement, key: string): void {
  if (key === ROOT_OVERRIDE_KEY) return;
  if (!tx.doc.elements.some((e) => e.id === `${owner.id}::${key}`)) {
    throw new ToolFailure('not_found', `Instance ${owner.id} has no instance child for master element "${key}".`);
  }
}

const OVERRIDE_PROPERTY_NAMES = [...OVERRIDABLE_PROPERTIES];

/** Properties an instance root accepts; every other root style comes from the master. */
const ROOT_OVERRIDE_PROPERTIES: readonly string[] = ['width', 'height', 'fill', 'stroke', 'opacity', 'imageFill'];

interface InstanceCreateInput {
  board?: string;
  master: string;
  x?: number;
  y?: number;
  parentId?: string;
}

const instanceCreateTool: ToolDefinition<InstanceCreateInput, { id: string; master: string; x: number; y: number }> = {
  name: 'openboard.component.instance.create',
  description:
    'Insert an instance of a component master. The instance is a Frame with the size of the master and one derived child per master descendant. `x` and `y` default to just right of the master. An instance that would make a master contain itself, or nest deeper than 8 levels, is rejected. One undo step.',
  inputSchema: s.object({
    board: boardProp(),
    master: s.string({ minLength: 1 }),
    x: s.opt(s.number()),
    y: s.opt(s.number()),
    parentId: s.opt(s.string({ minLength: 1 })),
  }),
  outputSchema: s.object({ id: s.string(), master: s.string(), x: s.number(), y: s.number() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const master = frameOf(tx, input.master);
    if (!master || master.component === undefined) {
      throw new ToolFailure('not_a_component', `Element ${input.master} is not a component master.`);
    }
    for (const [k, v] of [['x', input.x], ['y', input.y]] as const) {
      if (v !== undefined && !Number.isFinite(v)) throw new ToolFailure('invalid_property', `"${k}" must be a finite number`);
    }
    if (input.parentId !== undefined) {
      const parent = frameOf(tx, input.parentId);
      if (!parent) throw new ToolFailure('invalid_parent', `Parent ${input.parentId} is not an existing Frame.`);
      if (isInstanceChildId(parent.id)) {
        throw new ToolFailure('instance_child', `Element ${parent.id} belongs to a component instance; detach the instance first.`);
      }
    }
    const x = input.x ?? master.x + master.width + 40;
    const y = input.y ?? master.y;
    const { frame } = createFrame({ x, y, width: master.width, height: master.height }, [], { name: master.component });
    const created = tx.create({
      ...frame,
      instanceOf: master.id,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    });
    const nesting = frameNestingProblem(tx.doc.elements, [created.id]);
    if (nesting !== undefined) throw new ToolFailure('invalid_parent', nesting);
    assertSyncable(tx);
    return { id: created.id, master: master.id, x, y };
  },
};

interface OverrideSetInput {
  board?: string;
  id: string;
  childId?: string;
  property: string;
  value: unknown;
}

const overrideSetTool: ToolDefinition<OverrideSetInput, { id: string; key: string; property: string }> = {
  name: 'openboard.component.instance.override.set',
  description:
    'Override one property of an instance. `id` is an instance child (`<instanceId>::<masterChildId>`) or the instance itself (root: `width`, `height`, `fill`, `stroke`, `opacity`, `imageFill`; every other root style, such as corner radius and stroke width, follows the master). Alternatively pass the instance as `id` and a master child id as `childId` (`""` for the root). Overridable properties: text, fill, stroke, textColor, fontWeight, imageFill, icon, opacity, visible (false hides the child and its descendants, for state variants), and on the root width, height, fill, stroke, opacity and imageFill. One undo step.',
  inputSchema: s.object({
    board: boardProp(),
    id: s.string({ minLength: 1 }),
    childId: s.opt(s.string()),
    property: s.enum(OVERRIDE_PROPERTY_NAMES),
    value: {
      oneOf: [s.string(), s.number(), s.boolean(), s.object({ assetId: s.string(), fit: s.enum(['cover', 'contain', 'stretch']) })],
    },
  }),
  outputSchema: s.object({ id: s.string(), key: s.string(), property: s.string() }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const { owner, key } = resolveOverrideTarget(tx, input.id, input.childId);
    requireKnownChild(tx, owner, key);
    const root = key === ROOT_OVERRIDE_KEY;
    if (root && !ROOT_OVERRIDE_PROPERTIES.includes(input.property)) {
      throw new ToolFailure(
        'invalid_property',
        `Only ${ROOT_OVERRIDE_PROPERTIES.join(', ')} can be overridden on the instance root, not "${input.property}".`,
      );
    }
    const error = overrideValueError(input.property, input.value, root);
    if (error !== undefined) throw new ToolFailure('invalid_property', `"${input.property}" ${error}`);
    const current = owner.overrides?.[key];
    if (current && JSON.stringify((current as Record<string, unknown>)[input.property]) === JSON.stringify(input.value)) {
      return { id: owner.id, key, property: input.property };
    }
    const overrides = { ...owner.overrides, [key]: { ...current, [input.property]: input.value } as Override };
    tx.update(owner.id, { overrides });
    return { id: owner.id, key, property: input.property };
  },
};

interface OverrideResetInput {
  board?: string;
  id: string;
  childId?: string;
  property?: string;
}

const overrideResetTool: ToolDefinition<OverrideResetInput, { id: string; removed: number }> = {
  name: 'openboard.component.instance.override.reset',
  description:
    'Remove overrides and restore master values. `id` is an instance child, or an instance. For an instance, `childId` limits the reset to one master child (`""` for the root size). `property` limits it to one property. With neither, every override of the instance is removed. Nothing matching means no change and no undo step.',
  inputSchema: s.object({
    board: boardProp(),
    id: s.string({ minLength: 1 }),
    childId: s.opt(s.string()),
    property: s.opt(s.enum(OVERRIDE_PROPERTY_NAMES)),
  }),
  outputSchema: s.object({ id: s.string(), removed: s.integer({ min: 0 }) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const wholeInstance =
      input.childId === undefined &&
      !isInstanceChildId(input.id) &&
      frameOf(tx, input.id)?.instanceOf !== undefined;
    const target = resolveOverrideTarget(tx, input.id, input.childId);
    const owner = target.owner;
    const existing = owner.overrides ?? {};
    const next: Record<string, Override> = {};
    let removed = 0;
    for (const [k, o] of Object.entries(existing)) {
      const hit = wholeInstance ? true : k === target.key;
      if (!hit) {
        next[k] = o;
        continue;
      }
      if (input.property === undefined) {
        removed += Object.keys(o).length;
        continue;
      }
      const copy = { ...o } as Record<string, unknown>;
      if (input.property in copy) {
        delete copy[input.property];
        removed++;
      }
      if (Object.keys(copy).length > 0) next[k] = copy as Override;
    }
    if (removed === 0) return { id: owner.id, removed: 0 };
    tx.update(owner.id, { overrides: Object.keys(next).length > 0 ? next : undefined });
    return { id: owner.id, removed };
  },
};

const detachTool: ToolDefinition<{ board?: string; id: string }, { id: string; children: number }> = {
  name: 'openboard.component.instance.detach',
  description:
    'Detach a component instance: remove `instanceOf` and `overrides`, keeping every child with its current id, properties, parent, and position. Edges stay attached. One undo step.',
  inputSchema: s.object({ board: boardProp(), id: s.string({ minLength: 1 }) }),
  outputSchema: s.object({ id: s.string(), children: s.integer({ min: 0 }) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = requireTx(ctx.tx);
    const el = tx.doc.elements.find((e) => e.id === input.id);
    if (!el) throw new ToolFailure('not_found', `Element not found: ${input.id}`);
    if (el.type !== 'frame' || el.instanceOf === undefined) {
      throw new ToolFailure('not_an_instance', `Element ${input.id} is not a component instance.`);
    }
    const children = tx.doc.elements.filter((e) => e.id.startsWith(`${input.id}::`)).length;
    tx.update(input.id, { instanceOf: undefined, overrides: undefined });
    return { id: input.id, children };
  },
};

export const componentTools: ToolDefinition[] = [
  createTool as ToolDefinition,
  removeTool as ToolDefinition,
  listTool as ToolDefinition,
  instanceCreateTool as ToolDefinition,
  overrideSetTool as ToolDefinition,
  overrideResetTool as ToolDefinition,
  detachTool as ToolDefinition,
];

export function registerComponentTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of componentTools) registry.register(t);
}
