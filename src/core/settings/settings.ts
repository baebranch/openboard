/** Pure settings descriptors and validation (Req 18.3, 18.5). No vscode imports. */

export type ExportScale = 1 | 2 | 3 | 4;
export type ExportBackground = "transparent" | "white" | "theme";
export type AutoLayoutDirection = "horizontal" | "vertical";

export interface Settings {
  defaultExportScale: ExportScale;
  defaultExportBackground: ExportBackground;
  gridSpacing: number;
  defaultFontFamily: string;
  autoLayoutDirection: AutoLayoutDirection;
}

export type SettingKey = keyof Settings;

export interface SettingDescriptor<T> {
  /** Configuration key below the `openboard.` section. */
  readonly key: string;
  /** Returns true when the value is allowed. */
  readonly validate: (value: unknown) => value is T;
  /** Default value; the font default depends on the IDE editor font. */
  readonly getDefault: (ctx: SettingsContext) => T;
}

export interface SettingsContext {
  /** The IDE editor font family, used as the default font family. */
  readonly ideFontFamily: string;
}

export const FONT_FAMILY_MAX_LENGTH = 100;
export const FALLBACK_FONT_FAMILY = "sans-serif";
export const GRID_SPACING_MIN = 4;
export const GRID_SPACING_MAX = 200;

export const EXPORT_SCALES: readonly ExportScale[] = [1, 2, 3, 4];
export const EXPORT_BACKGROUNDS: readonly ExportBackground[] = ["transparent", "white", "theme"];
export const LAYOUT_DIRECTIONS: readonly AutoLayoutDirection[] = ["horizontal", "vertical"];

function isValidFont(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= FONT_FAMILY_MAX_LENGTH;
}

export const SETTING_DESCRIPTORS: { [K in SettingKey]: SettingDescriptor<Settings[K]> } = {
  defaultExportScale: {
    key: "defaultExportScale",
    validate: (v): v is ExportScale => typeof v === "number" && (EXPORT_SCALES as readonly number[]).includes(v),
    getDefault: () => 2,
  },
  defaultExportBackground: {
    key: "defaultExportBackground",
    validate: (v): v is ExportBackground => typeof v === "string" && (EXPORT_BACKGROUNDS as readonly string[]).includes(v),
    getDefault: () => "theme",
  },
  gridSpacing: {
    key: "gridSpacing",
    validate: (v): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= GRID_SPACING_MIN && v <= GRID_SPACING_MAX,
    getDefault: () => 20,
  },
  defaultFontFamily: {
    key: "defaultFontFamily",
    validate: isValidFont,
    getDefault: (ctx) => (isValidFont(ctx.ideFontFamily) ? ctx.ideFontFamily : FALLBACK_FONT_FAMILY),
  },
  autoLayoutDirection: {
    key: "autoLayoutDirection",
    validate: (v): v is AutoLayoutDirection =>
      typeof v === "string" && (LAYOUT_DIRECTIONS as readonly string[]).includes(v),
    getDefault: () => "horizontal",
  },
};

export const SETTING_KEYS = Object.keys(SETTING_DESCRIPTORS) as SettingKey[];

/** Returns the value if valid, otherwise the default. Never writes anywhere. */
export function resolveSetting<K extends SettingKey>(key: K, raw: unknown, ctx: SettingsContext): Settings[K] {
  const d = SETTING_DESCRIPTORS[key] as SettingDescriptor<Settings[K]>;
  return d.validate(raw) ? raw : d.getDefault(ctx);
}

/** Resolves all settings from a raw key->value reader; invalid or missing values yield defaults. */
export function resolveSettings(
  read: (key: SettingKey) => unknown,
  ctx: SettingsContext,
): Settings {
  return {
    defaultExportScale: resolveSetting("defaultExportScale", read("defaultExportScale"), ctx),
    defaultExportBackground: resolveSetting("defaultExportBackground", read("defaultExportBackground"), ctx),
    gridSpacing: resolveSetting("gridSpacing", read("gridSpacing"), ctx),
    defaultFontFamily: resolveSetting("defaultFontFamily", read("defaultFontFamily"), ctx),
    autoLayoutDirection: resolveSetting("autoLayoutDirection", read("autoLayoutDirection"), ctx),
  };
}
