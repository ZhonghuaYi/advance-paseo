// Theme options shown in the workspace header switcher. Built-in entries
// mirror the app's THEME_OPTIONS (names and swatches decoded from the host
// bundle); plugin entries derive from this plugin's registered palettes.
// Display labels for built-ins live in the i18n dictionaries; plugin themes
// reuse their registered names (proper nouns).

import { PALETTE_PAIRS } from "../wallpaper/palettes";

export interface BuiltinThemeOption {
  /** Value written to the app-settings "theme" field. */
  readonly preference: string;
  /** Swatch color shown next to the label. */
  readonly swatch: string;
}

export interface PluginThemeOption {
  readonly preference: "plugin";
  readonly pluginThemeId: string;
  /** Registered display name of the contributed theme. */
  readonly name: string;
  readonly swatch: string;
}

export const BUILTIN_THEME_OPTIONS: readonly BuiltinThemeOption[] = [
  { preference: "light", swatch: "#FFFFFF" },
  { preference: "dark", swatch: "#2D8B62" },
  { preference: "auto", swatch: "#94A3B8" },
  { preference: "zinc", swatch: "#808080" },
  { preference: "midnight", swatch: "#4A6BA8" },
  { preference: "claude", swatch: "#D97757" },
  { preference: "ghostty", swatch: "#8CAAEE" },
  { preference: "pureBlack", swatch: "#000000" },
];

export const PLUGIN_THEME_OPTIONS: readonly PluginThemeOption[] = PALETTE_PAIRS.flatMap(
  (pair) => [
    {
      preference: "plugin",
      pluginThemeId: pair.light.id,
      name: pair.light.name,
      swatch: pair.light.colors.background,
    },
    {
      preference: "plugin",
      pluginThemeId: pair.dark.id,
      name: pair.dark.name,
      swatch: pair.dark.colors.background,
    },
  ],
);

/** The app-settings preference fields the switcher reads and writes. */
export interface AppThemePreference {
  readonly theme: string;
  readonly pluginThemeId: string | null;
}

/** Plugin button ids must match /^[a-z][a-z0-9-]*$/ (validated by the host),
 * but workspace ids look like "wks_ca0cd12d5de8c6d0" — underscores and any
 * other run of invalid characters collapses into a dash. */
export function buttonIdSuffix(workspaceId: string): string {
  return workspaceId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isActiveBuiltin(
  option: BuiltinThemeOption,
  preference: AppThemePreference | null,
): boolean {
  return preference !== null && preference.theme === option.preference;
}

export function isActivePluginTheme(
  option: PluginThemeOption,
  preference: AppThemePreference | null,
): boolean {
  return (
    preference !== null &&
    preference.theme === "plugin" &&
    preference.pluginThemeId === option.pluginThemeId
  );
}
