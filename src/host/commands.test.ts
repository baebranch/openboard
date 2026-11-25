import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, NO_ACTIVE_BOARD_MESSAGE, PALETTE_COMMAND_IDS, exportFormatForPath, planCommand, type CommandKey } from './commands';
import { SettingsBroadcaster, readSettings } from './settings-sync';

describe('commands', () => {
  it('declares exactly seven unique commands', () => {
    expect(PALETTE_COMMAND_IDS).toHaveLength(7);
    expect(new Set(PALETTE_COMMAND_IDS).size).toBe(7);
  });

  it('notifies when a board-bound command runs without an active board', () => {
    for (const key of Object.keys(COMMAND_IDS) as CommandKey[]) {
      const plan = planCommand(key, false);
      if (key === 'newBoard' || key === 'copyMcpConfig') expect(plan).toEqual({ action: 'run' });
      else expect(plan).toEqual({ action: 'notify', message: NO_ACTIVE_BOARD_MESSAGE });
      expect(planCommand(key, true)).toEqual({ action: 'run' });
    }
  });

  it('maps export file names to formats', () => {
    expect(exportFormatForPath('a.SVG')).toBe('svg');
    expect(exportFormatForPath('a.jpg')).toBe('jpeg');
    expect(exportFormatForPath('a')).toBe('png');
  });
});

describe('settings sync', () => {
  it('uses defaults for invalid values and pushes only changes', () => {
    let raw: Record<string, unknown> = { gridSpacing: 9999 };
    const pushed: number[] = [];
    const b = new SettingsBroadcaster(
      () => readSettings((k) => raw[k], 'Consolas'),
      (s) => pushed.push(s.gridSpacing),
    );
    expect(b.current().gridSpacing).toBe(20);
    expect(b.current().defaultFontFamily).toBe('Consolas');
    expect(b.refresh()).toBe(false);
    raw = { gridSpacing: 40 };
    expect(b.refresh()).toBe(true);
    expect(pushed).toEqual([40]);
  });
});
