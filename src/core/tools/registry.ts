import type { BoardModel, Tx } from '../ops';
import { defaultValidatorFactory } from './json-schema';
import type { JSONSchema, ValidationIssue, Validator, ValidatorFactory } from './json-schema';

export type BoardResolution = 'required-or-active' | 'create' | 'none';

/** Context passed to handlers. `model`/`tx` are present when a board was resolved. */
export interface ToolContext {
  readonly model?: BoardModel;
  /** The open transaction. Handlers with a board mutate only through this. */
  readonly tx?: Tx;
  readonly toolName: string;
}

export interface ToolDefinition<I = any, O = any> {
  /** 1..64 chars, [a-z0-9_.-] */
  name: string;
  /** 1..1000 chars */
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  destructive?: boolean;
  /** Writes files other than the active board (workspace trust gate). */
  writesElsewhere?: boolean;
  /** Tool never mutates a board (viewing). Used by the workspace trust gate. */
  readOnly?: boolean;
  boardResolution: BoardResolution;
  /**
   * With `async`, a resolved board is passed as `ctx.model` but no transaction is opened and no
   * history entry is pushed (`ctx.tx` is absent); the handler may return a promise. Meant for
   * read-only tools that need I/O, such as export.
   */
  async?: boolean;
  /**
   * With a resolved board the handler runs synchronously inside `model.transact` (a returned
   * promise is an internal error). Tools without a board may be async.
   */
  handler(ctx: ToolContext, input: I): Promise<O> | O;
}

export interface ToolError {
  code: string;
  message?: string;
  issues?: ValidationIssue[];
}

export type ToolErrorResult = { error: ToolError };

export type BoardResolveResult = { ok: true; model?: BoardModel } | { ok: false; error: ToolError };

/** Hook filled by task 6.2 (board resolution + trust gate). */
export interface BoardResolver {
  resolve(def: ToolDefinition, input: unknown): Promise<BoardResolveResult> | BoardResolveResult;
}

export interface ToolDescription {
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

/**
 * Joins an invocation to a multi-call unit of work (see `ToolSession`): called once the board is
 * resolved, before the tool runs. May reject, which fails the invocation with `board_busy`.
 */
export interface InvokeSession {
  enter(model: BoardModel): Promise<void>;
}

export interface InvokeOptions {
  session?: InvokeSession;
}

export interface ToolRegistry {
  list(): string[];
  describe(name: string): ToolDescription;
  invoke(name: string, input: unknown, options?: InvokeOptions): Promise<unknown>;
}

export interface ToolRegistryOptions {
  validators?: ValidatorFactory;
  resolver?: BoardResolver;
}

const NAME_RE = /^[a-z0-9_.-]{1,64}$/;

/** Thrown inside a transaction to roll it back and surface a structured error. */
class AbortInvoke extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message ?? toolError.code);
  }
}

interface Entry {
  def: ToolDefinition;
  validateInput: Validator;
  validateOutput: Validator;
}

export class DefaultToolRegistry implements ToolRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly validators: ValidatorFactory;
  resolver: BoardResolver | undefined;

  constructor(options: ToolRegistryOptions = {}) {
    this.validators = options.validators ?? defaultValidatorFactory;
    this.resolver = options.resolver;
  }

  register(def: ToolDefinition): void {
    if (!NAME_RE.test(def.name)) throw new Error(`Invalid tool name: ${def.name}`);
    if (def.description.length < 1 || def.description.length > 1000) {
      throw new Error(`Tool ${def.name}: description must be 1..1000 characters`);
    }
    if (this.entries.has(def.name)) throw new Error(`Duplicate tool: ${def.name}`);
    this.entries.set(def.name, {
      def,
      validateInput: this.validators.compile(def.inputSchema),
      validateOutput: this.validators.compile(def.outputSchema),
    });
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  def(name: string): ToolDefinition {
    const e = this.entries.get(name);
    if (!e) throw new Error(`Unknown tool: ${name}`);
    return e.def;
  }

  /** Definition plus compiled validators, for composite tools such as `openboard.batch`. */
  resolveTool(name: string): { def: ToolDefinition; validateInput: Validator; validateOutput: Validator } | undefined {
    return this.entries.get(name);
  }

  describe(name: string): ToolDescription {
    const d = this.def(name);
    return { description: d.description, inputSchema: d.inputSchema, outputSchema: d.outputSchema };
  }

  async invoke(name: string, input: unknown, options?: InvokeOptions): Promise<unknown> {
    const entry = this.entries.get(name);
    if (!entry) return fail('unknown_tool', `Unknown tool: ${String(name)}`);
    const { def } = entry;

    const checked = entry.validateInput(input);
    if (!checked.ok) {
      return { error: { code: 'invalid_input', message: `Invalid input for ${name}`, issues: checked.issues } };
    }

    let model: BoardModel | undefined;
    if (this.resolver) {
      const r = await this.resolver.resolve(def, input);
      if (!r.ok) return { error: r.error };
      model = r.model;
    } else if (def.boardResolution === 'required-or-active') {
      return fail('no_board', 'No board is available for this tool');
    }

    if (model && options?.session && def.boardResolution !== 'none' && !def.readOnly) {
      try {
        await options.session.enter(model);
      } catch (e) {
        return { error: toToolError(e) };
      }
    }

    try {
      if (model && def.async && def.boardResolution !== 'none') {
        const out = await def.handler({ model, toolName: name }, input);
        this.checkOutput(entry, out);
        return out;
      }
      if (model && def.boardResolution !== 'none') {
        const m = model;
        return await m.serialQueue.run(() =>
          m.transact(name, (tx) => {
            const out = def.handler({ model: m, tx, toolName: name }, input);
            if (isThenable(out)) {
              throw new AbortInvoke({ code: 'internal_error', message: `Handler for ${name} returned a promise inside a transaction` });
            }
            this.checkOutput(entry, out);
            return out;
          }),
        );
      }
      const out = await def.handler({ toolName: name }, input);
      this.checkOutput(entry, out);
      return out;
    } catch (e) {
      if (e instanceof AbortInvoke) return { error: e.toolError };
      return { error: toToolError(e) };
    }
  }

  private checkOutput(entry: Entry, out: unknown): void {
    const r = entry.validateOutput(out);
    if (!r.ok) {
      throw new AbortInvoke({
        code: 'internal_error',
        message: `Output of ${entry.def.name} violates its outputSchema`,
        issues: r.issues,
      });
    }
  }
}

function fail(code: string, message: string): ToolErrorResult {
  return { error: { code, message } };
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

function toToolError(e: unknown): ToolError {
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  return { code: typeof code === 'string' ? code : 'handler_error', message };
}
