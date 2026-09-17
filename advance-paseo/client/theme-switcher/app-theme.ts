// Applies theme preferences by persisting the app's own settings fields and
// flipping the host's theme class on <html> for the immediate visual switch.
//
// Why not react-query: the host gives every plugin installation its OWN
// QueryClient instance (PluginRuntimeBoundary renders plugins under
// `<plugin>.queryClient`, verified against the host bundle). The app's
// appearance settings live in a separate app-owned client, so a cache patch
// written from plugin code updates an entry nobody observes.
//
// Why the class flip is safe and complete: react-native-unistyles compiles
// every registered theme's variables into `:root.<themeName>` rules and the
// app itself activates a theme by toggling that class on <html> (built-ins:
// light/dark/zinc/midnight/claude/ghostty/pureBlack; plugin themes:
// pluginLight/pluginDark). Flipping the class switches every CSS variable —
// the whole UI — through the app's own mechanism, with no access to host
// internals. "auto" has no class; the prefers-color-scheme media rules then
// decide, exactly as the app leaves it.
//
// The preference is also persisted to the same localStorage fields the app's
// appearance picker writes (`theme`, `pluginThemeId`), so the choice survives
// restart and the app adopts it on its next settings read. The app's
// in-memory unistyles state may briefly disagree; the next app-driven theme
// operation or launch reconciles it.

import { ALL_THEME_CLASSES, type AppThemePreference } from "./catalog";

export const APP_SETTINGS_STORAGE_KEY = "app-settings";

/** Parse the persisted preference fields; null when absent or malformed. */
export function parseAppThemePreference(raw: string | null): AppThemePreference | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const theme = Reflect.get(parsed, "theme");
  if (typeof theme !== "string" || theme.length === 0) return null;
  const pluginThemeId = Reflect.get(parsed, "pluginThemeId");
  return {
    theme,
    pluginThemeId: typeof pluginThemeId === "string" ? pluginThemeId : null,
  };
}

/** Current preference from localStorage; null on native hosts. */
export function readAppThemePreference(): AppThemePreference | null {
  if (typeof localStorage === "undefined") return null;
  return parseAppThemePreference(localStorage.getItem(APP_SETTINGS_STORAGE_KEY));
}

/**
 * The full stored settings document, so a write merges without wiping
 * unrelated fields (fonts, language, …). Malformed storage reads as an
 * empty document.
 */
function readStoredAppSettings(): Record<string, unknown> {
  const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  let parsed: unknown;
  try {
    parsed = raw === null ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Shallow-merge a preference patch onto a settings document. */
export function mergeAppSettingsTheme(
  current: unknown,
  preference: AppThemePreference,
): Record<string, unknown> {
  const base =
    typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, theme: preference.theme, pluginThemeId: preference.pluginThemeId };
}

/**
 * Built-in theme preference -> unistyles theme class on <html>. Plugin
 * preferences map through the contributed palette's appearance; "auto" maps
 * to no class (the OS media rules decide, as the app leaves it).
 */
export function themeClassFor(
  preference: AppThemePreference,
  contributedAppearance: "light" | "dark",
): string | null {
  if (preference.theme === "plugin") {
    return contributedAppearance === "light" ? "pluginLight" : "pluginDark";
  }
  switch (preference.theme) {
    case "light":
    case "dark":
    case "zinc":
    case "midnight":
    case "claude":
    case "ghostty":
    case "pureBlack":
      return preference.theme;
    default:
      return null;
  }
}

/**
 * Switch the active theme: persist the preference, then flip the theme class
 * on <html> for the immediate visual change. Returns false (and changes
 * nothing) when the storage pipeline is unavailable, e.g. on native hosts.
 */
export function applyAppThemePreference(
  preference: AppThemePreference,
  contributedAppearance: "light" | "dark",
): boolean {
  if (typeof localStorage === "undefined" || typeof document === "undefined") return false;

  const next = mergeAppSettingsTheme(readStoredAppSettings(), preference);
  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }

  const themeClass = themeClassFor(preference, contributedAppearance);
  const classList = document.documentElement.classList;
  for (const name of ALL_THEME_CLASSES) classList.remove(name);
  if (themeClass !== null) classList.add(themeClass);
  return true;
}
