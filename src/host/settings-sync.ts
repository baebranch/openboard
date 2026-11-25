/** Pure settings reading and change broadcasting (Req 18.2-18.5). Never writes values back. */
import { SETTING_KEYS, resolveSettings, type SettingKey, type Settings } from '../core/settings/settings';

export function readSettings(get: (key: SettingKey) => unknown, ideFontFamily: string): Settings {
  return resolveSettings(get, { ideFontFamily });
}

export function settingsEqual(a: Settings, b: Settings): boolean {
  return SETTING_KEYS.every((k) => a[k] === b[k]);
}

/** Keeps the last resolved settings and pushes only real changes, synchronously. */
export class SettingsBroadcaster {
  private last: Settings;

  constructor(
    private readonly read: () => Settings,
    private readonly push: (settings: Settings) => void,
  ) {
    this.last = read();
  }

  current(): Settings {
    return this.last;
  }

  /** Re-reads; pushes when the resolved value changed. Returns whether a push happened. */
  refresh(): boolean {
    const next = this.read();
    if (settingsEqual(next, this.last)) return false;
    this.last = next;
    this.push(next);
    return true;
  }
}
