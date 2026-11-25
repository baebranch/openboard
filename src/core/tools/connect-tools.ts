/**
 * `openboard.connect` (Req 8.2, 8.3, 8.5, 8.6, 8.7): create 1..N edges between existing elements, or
 * from an element to a new process Flow_Node centered at `toPosition`. Atomic: every spec is
 * validated before the document is touched, and a failure aborts the whole transaction.
 */
import type { EdgeElement, Element, FlowNodeElement } from '../model';
import { EDGE_LABEL_MAX } from '../model';
import type { ElementInput, Tx } from '../ops';
import { validateProperty } from '../properties';
import { getFlowNodePreset } from '../flow/presets';
import { s } from '../schema/builder';
import { defaultStyle } from '../shapes';
import type { DefaultToolRegistry, ToolContext, ToolDefinition } from './registry';

export const MAX_CONNECT = 1000;

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ROUTINGS = ['straight', 'curved', 'orthogonal'] as const;
const ARROW_HEADS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const;

interface ConnectSpec {
  sourceId: string;
  targetId?: string;
  toPosition?: { x: number; y: number };
  routing?: (typeof ROUTINGS)[number];
  sourceArrow?: (typeof ARROW_HEADS)[number];
  targetArrow?: (typeof ARROW_HEADS)[number];
  strokeStyle?: string;
  label?: string;
}

interface ConnectInput {
  edges: ConnectSpec[];
}

interface ConnectOutput {
  edges: Element[];
  createdNodes: Element[];
  ids: string[];
}

const boardProp = () => s.opt(s.string({ minLength: 1 }));
const items = () => s.array(s.object({}));

function needTx(ctx: ToolContext): Tx {
  if (!ctx.tx) throw new ToolFailure('no_board', 'No board is available for this tool');
  return ctx.tx;
}

/** An endpoint must exist and must not itself be an edge. */
function requireEndpoint(tx: Tx, id: string, where: string): Element {
  const el = tx.doc.elements.find((e) => e.id === id);
  if (!el) throw new ToolFailure('not_found', `${where}: element not found: ${id}`);
  if (el.type === 'edge') throw new ToolFailure('invalid_endpoint', `${where}: ${id} is an edge and cannot be connected`);
  return el;
}

const connectTool: ToolDefinition<ConnectInput, ConnectOutput> = {
  name: 'openboard.connect',
  description:
    'Create 1 to 1000 edges. Each item has `sourceId` and either `targetId` (an existing element; may equal sourceId for a self-loop) or `toPosition` {x, y} (creates a new process flow node centered there and connects to it). Optional: `routing` (straight, curved, orthogonal; default straight), `sourceArrow`, `targetArrow`, `strokeStyle`, `label` (up to 200 characters). Endpoints must exist and must not be edges; the call is all-or-nothing.',
  inputSchema: s.object({
    board: boardProp(),
    edges: s.array(
      s.object({
        sourceId: s.string({ minLength: 1 }),
        targetId: s.opt(s.string({ minLength: 1 })),
        toPosition: s.opt(s.object({ x: s.number(), y: s.number() })),
        routing: s.opt(s.enum(ROUTINGS)),
        sourceArrow: s.opt(s.enum(ARROW_HEADS)),
        targetArrow: s.opt(s.enum(ARROW_HEADS)),
        strokeStyle: s.opt(s.enum(['solid', 'dashed', 'dotted'])),
        label: s.opt(s.string({ maxLength: EDGE_LABEL_MAX })),
      }),
      { minItems: 1, maxItems: MAX_CONNECT },
    ),
  }),
  outputSchema: s.object({ edges: items(), createdNodes: items(), ids: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);

    // Validate everything first so a bad item leaves the document untouched.
    input.edges.forEach((spec, i) => {
      const where = `edges[${i}]`;
      if ((spec.targetId === undefined) === (spec.toPosition === undefined)) {
        throw new ToolFailure('invalid_input', `${where}: provide exactly one of targetId or toPosition`);
      }
      requireEndpoint(tx, spec.sourceId, where);
      if (spec.targetId !== undefined) requireEndpoint(tx, spec.targetId, where);
      if (spec.label !== undefined && spec.label.length > EDGE_LABEL_MAX) {
        throw new ToolFailure('invalid_property', `${where}: label must be at most ${EDGE_LABEL_MAX} characters`);
      }
      if (spec.strokeStyle !== undefined) {
        const r = validateProperty('edge', 'strokeStyle', spec.strokeStyle);
        if (!r.ok) throw new ToolFailure('invalid_property', `${where}: ${r.error}`);
      }
    });

    const edges: Element[] = [];
    const createdNodes: Element[] = [];
    for (const spec of input.edges) {
      let targetId = spec.targetId;
      if (spec.toPosition) {
        const info = getFlowNodePreset('process');
        const node = tx.create({
          type: 'flowNode',
          x: spec.toPosition.x - info.width / 2,
          y: spec.toPosition.y - info.height / 2,
          width: info.width,
          height: info.height,
          rotation: 0,
          runs: [{ text: '' }],
          fontFamily: 'sans-serif',
          fontSize: 16,
          align: 'center',
          preset: 'process',
          style: { ...defaultStyle(), cornerRadius: info.cornerRadius },
        } satisfies Omit<FlowNodeElement, 'id'> as ElementInput);
        createdNodes.push(node);
        targetId = node.id;
      }
      const edge: Omit<EdgeElement, 'id'> = {
        type: 'edge',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        sourceId: spec.sourceId,
        targetId: targetId as string,
        routing: spec.routing ?? 'straight',
        sourceArrow: spec.sourceArrow ?? 'none',
        targetArrow: spec.targetArrow ?? 'arrow',
        style: { ...defaultStyle(), ...(spec.strokeStyle ? { strokeStyle: spec.strokeStyle as 'solid' } : {}) },
      };
      if (spec.label !== undefined) edge.label = spec.label;
      edges.push(tx.create(edge as ElementInput));
    }
    return { edges, createdNodes, ids: edges.map((e) => e.id) };
  },
};

export const connectTools: ToolDefinition[] = [connectTool as unknown as ToolDefinition];

export function registerConnectTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of connectTools) registry.register(t);
}
