import type { BoardModel } from '../ops';
import type { BoardResolver, BoardResolveResult, ToolDefinition } from './registry';

/** Host services needed for board resolution and the trust gate. */
export interface BoardHost {
  /** The open model for `path`, if the board is open. */
  isOpen(path: string): BoardModel | undefined;
  exists(path: string): Promise<boolean> | boolean;
  /** Open without an editor tab. */
  openInBackground(path: string): Promise<BoardModel> | BoardModel;
  activeBoard(): BoardModel | undefined;
  openBoards(): string[];
  isWorkspaceTrusted(): boolean;
}

export function normalizeBoardPath(p: string): string {
  const s = p.replace(/\\/g, '/');
  const out: string[] = [];
  for (const part of s.split('/')) {
    if (part === '.') continue;
    if (part === '..' && out.length > 1 && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/').replace(/(?<=.)\/+$/, '');
}

function requestedBoard(input: unknown): string | undefined {
  const b = (input as { board?: unknown } | null | undefined)?.board;
  return typeof b === 'string' && b.length > 0 ? normalizeBoardPath(b) : undefined;
}

/** Req 16.9: reject writes elsewhere in an untrusted workspace. Returns an error result or undefined. */
export function checkTrust(host: BoardHost, def: ToolDefinition, input: unknown): BoardResolveResult | undefined {
  if (host.isWorkspaceTrusted()) return undefined;
  const untrusted = (message: string): BoardResolveResult => ({
    ok: false,
    error: { code: 'workspace_untrusted', message },
  });
  if (def.writesElsewhere) {
    return untrusted(`Tool ${def.name} writes files and is not available in an untrusted workspace`);
  }
  if (def.readOnly || def.boardResolution === 'none') return undefined;
  const target = requestedBoard(input);
  if (target === undefined) return undefined; // active board
  const active = host.activeBoard();
  if (active && normalizeBoardPath(active.path) === target) return undefined;
  return untrusted(`Writing to ${target} is not allowed in an untrusted workspace`);
}

export class HostBoardResolver implements BoardResolver {
  constructor(private readonly host: BoardHost) {}

  async resolve(def: ToolDefinition, input: unknown): Promise<BoardResolveResult> {
    const trust = checkTrust(this.host, def, input);
    if (trust) return trust;
    if (def.boardResolution === 'none') return { ok: true };

    const path = requestedBoard(input);
    if (path !== undefined) {
      const open = this.host.isOpen(path);
      if (open) return { ok: true, model: open };
      if (await this.host.exists(path)) {
        return { ok: true, model: await this.host.openInBackground(path) };
      }
      if (def.boardResolution === 'create') return { ok: true };
      return { ok: false, error: { code: 'not_found', message: `Board not found: ${path}` } };
    }

    const active = this.host.activeBoard();
    if (active) return { ok: true, model: active };
    if (def.boardResolution === 'create') return { ok: true };
    const open = this.host.openBoards();
    return {
      ok: false,
      error: {
        code: 'no_active_board',
        message: `No active board. Open boards: ${open.length ? open.join(', ') : '(none)'}`,
      },
    };
  }
}
