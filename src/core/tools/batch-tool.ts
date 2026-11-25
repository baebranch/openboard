/**
 * `openboard.batch` (Req 13.6, 13.7, 10.6, 17.4, 17.7): runs 1..500 ordered board operations in ONE
 * `model.transact`, so a failure at index i rolls everything back and exactly one undo entry is
 * recorded on success.
 *
 * The tool is flagged `async` so the registry hands it `ctx.model` without opening a transaction;
 * the handler opens the single transaction itself (so it can turn a rollback into a structured
 * `{ ok: false, error }` result) and calls each sub-tool's synchronous handler directly with a
 * context that shares that transaction. Sub-inputs and outputs are validated with the registry's
 * own compiled validators. Sub-operations run against the batch's board; any `board` in a
 * sub-input is ignored.
 */
import { s } from '../schema/builder';
import type { DefaultToolRegistry, ToolContext, ToolDefinition } from './registry';

export const BATCH_TOOL_NAME = 'openboard.batch';
export const MAX_BATCH_OPERATIONS = 500;
/** Soft target: exceeding it sets `exceededTimeTarget` but never aborts. */
export const BATCH_TIME_TARGET_MS = 5000;

export interface BatchInput {
  board?: string;
  operations: Array<{ tool: string; input?: unknown }>;
}

export interface BatchFailure {
  index: number;
  reason: string;
  issues?: unknown[];
}

export type BatchOutput =
  | { ok: true; results: unknown[]; exceededTimeTarget?: boolean }
  | { ok: false; error: BatchFailure };

class OpFailure extends Error {
  constructor(readonly failure: BatchFailure) {
    super(failure.reason);
  }
}

type Resolver = Pick<DefaultToolRegistry, 'resolveTool'>;
type Resolved = NonNullable<ReturnType<Resolver['resolveTool']>>;
interface Step {
  entry: Resolved;
  input: unknown;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const isThenable = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** Resolves and validates every operation before the board is touched. Throws OpFailure. */
function planOperations(registry: Resolver, input: BatchInput): Step[] {
  return input.operations.map((op, index) => {
    const fail = (reason: string, issues?: unknown[]): never => {
      throw new OpFailure(issues ? { index, reason, issues } : { index, reason });
    };
    if (op.tool === BATCH_TOOL_NAME) return fail('Nested batch operations are not allowed');
    const entry = registry.resolveTool(op.tool);
    if (!entry) return fail(`Unknown tool: ${op.tool}`);
    const { def } = entry;
    if (def.async || def.boardResolution !== 'required-or-active' || def.writesElsewhere) {
      return fail(`Tool ${op.tool} cannot run inside a batch (async or non-board tools are not supported)`);
    }
    const stepInput = op.input ?? {};
    const checked = entry.validateInput(stepInput);
    if (!checked.ok) return fail(`Invalid input for ${op.tool}`, checked.issues);
    return { entry, input: stepInput };
  });
}

export function createBatchTool(registry: Resolver): ToolDefinition<BatchInput, BatchOutput> {
  return {
    name: BATCH_TOOL_NAME,
    description:
      'Run 1 to 500 board tool operations in order as one atomic, single-undo transaction. If any operation fails, nothing is applied and the failing index and reason are returned. Nested batches and async tools (export, preview) are not allowed.',
    inputSchema: s.object({
      board: s.opt(s.string()),
      operations: s.array(s.object({ tool: s.string(), input: s.opt(s.object({})) }), {
        minItems: 1,
        maxItems: MAX_BATCH_OPERATIONS,
      }),
    }),
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        results: { type: 'array', items: {} },
        exceededTimeTarget: { type: 'boolean' },
        error: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            reason: { type: 'string' },
            issues: { type: 'array', items: {} },
          },
          required: ['index', 'reason'],
        },
      },
      required: ['ok'],
    },
    // Destructive when any sub-operation is (see confirm.ts isDestructiveInvocation); the static
    // flag stays false so non-destructive batches need no confirmation.
    boardResolution: 'required-or-active',
    async: true,
    async handler(ctx: ToolContext, input: BatchInput): Promise<BatchOutput> {
      const model = ctx.model;
      if (!model) return { ok: false, error: { index: 0, reason: 'No board is available for this tool' } };

      let plan: Step[];
      try {
        plan = planOperations(registry, input);
      } catch (e) {
        if (e instanceof OpFailure) return { ok: false, error: e.failure };
        throw e;
      }

      const start = now();
      try {
        const results = await model.serialQueue.run(() =>
          model.transact(BATCH_TOOL_NAME, (tx) => {
            const out: unknown[] = [];
            plan.forEach((step, index) => {
              const name = step.entry.def.name;
              let result: unknown;
              try {
                result = step.entry.def.handler({ model, tx, toolName: name }, step.input);
              } catch (e) {
                throw new OpFailure({ index, reason: e instanceof Error ? e.message : String(e) });
              }
              if (isThenable(result)) {
                throw new OpFailure({ index, reason: `Tool ${name} returned a promise inside a batch` });
              }
              const checked = step.entry.validateOutput(result);
              if (!checked.ok) {
                throw new OpFailure({ index, reason: `Output of ${name} violates its outputSchema`, issues: checked.issues });
              }
              out.push(result);
            });
            return out;
          }),
        );
        const ok: BatchOutput = { ok: true, results };
        if (now() - start > BATCH_TIME_TARGET_MS) ok.exceededTimeTarget = true;
        return ok;
      } catch (e) {
        if (e instanceof OpFailure) return { ok: false, error: e.failure };
        // Commit-time failure (e.g. invariant violation): the whole batch was rolled back.
        return {
          ok: false,
          error: { index: input.operations.length - 1, reason: e instanceof Error ? e.message : String(e) },
        };
      }
    },
  };
}

export function registerBatchTool(registry: Pick<DefaultToolRegistry, 'register' | 'resolveTool'>): void {
  registry.register(createBatchTool(registry));
}
