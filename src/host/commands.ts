/** Pure command table and availability logic (Req 18.1, 18.2). No vscode imports. */

export const COMMAND_IDS = {
  newBoard: 'openboard.newBoard',
  export: 'openboard.exportBoard',
  zoomToFit: 'openboard.zoomToFit',
  toggleGrid: 'openboard.toggleGrid',
  toggleMinimap: 'openboard.toggleMinimap',
  openAsText: 'openboard.openAsText',
  copyMcpConfig: 'openboard.copyMcpConfig',
} as const;

export type CommandKey = keyof typeof COMMAND_IDS;
export type CommandId = (typeof COMMAND_IDS)[CommandKey];

/** The seven Command Palette commands. */
export const PALETTE_COMMAND_IDS: readonly CommandId[] = Object.values(COMMAND_IDS);

/** View commands that are forwarded to the active board's webview. */
export type ViewCommand = 'zoomToFit' | 'toggleGrid' | 'toggleMinimap';

export const NO_ACTIVE_BOARD_MESSAGE = 'OpenBoard: an active board is required for this command.';

export function requiresActiveBoard(key: CommandKey): boolean {
  return key !== 'newBoard' && key !== 'copyMcpConfig';
}

export type CommandPlan = { action: 'run' } | { action: 'notify'; message: string };

/** Decides whether a command may run; when it may not, board state must stay untouched. */
export function planCommand(key: CommandKey, hasActiveBoard: boolean): CommandPlan {
  if (requiresActiveBoard(key) && !hasActiveBoard) return { action: 'notify', message: NO_ACTIVE_BOARD_MESSAGE };
  return { action: 'run' };
}

const EXPORT_EXTENSIONS = ['png', 'svg', 'jpeg', 'jpg', 'webp', 'pdf'] as const;

/** Export format for a chosen file name (defaults to png). */
export function exportFormatForPath(path: string): 'png' | 'svg' | 'jpeg' | 'webp' | 'pdf' {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (!(EXPORT_EXTENSIONS as readonly string[]).includes(ext)) return 'png';
  return ext === 'jpg' ? 'jpeg' : (ext as 'png' | 'svg' | 'jpeg' | 'webp' | 'pdf');
}
