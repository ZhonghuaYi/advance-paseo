// Applies theme preferences through the host's app-settings pipeline.
//
// Paseo stores its appearance preference in localStorage under "app-settings"
// and mirrors it into a react-query cache entry keyed ["app-settings"]; the
// AppearanceProvider re-applies the theme whenever that cache entry changes.
// The host injects its own react-query instance into plugin code, so a plugin
// component rendered inside the app tree can update the cache exactly like
// the app's own settings screen does: merge the patch into the current
// document, write the cache, and persist the same object to localStorage.
// This replicates the host's saveAppSettings (a shallow merge + same-key
// write) rather than calling private internals.

import type { AppThemePreference } from "./catalog";

export const APP_SETTINGS_STORAGE_KEY = "app-settings";
const APP_SETTINGS_QUERY_KEY: readonly unknown[] = ["app-settings"];

/** Structural slice of the injected QueryClient the switcher relies on. */
export interface AppSettingsQueryClient {
  getQueryData(queryKey: readonly unknown[]): unknown;
  setQueryData(queryKey: readonly unknown[], updater: unknown): unknown;
}

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
 * The full stored settings document, so a cache miss can merge without
 * wiping unrelated fields (fonts, language, …). Malformed storage reads as
 * an empty document.
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

/** Shallow-merge a preference patch onto the stored settings document. */
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
 * Switch the active theme. Returns false (and changes nothing) when the
 * storage pipeline is unavailable, e.g. on native hosts.
 */
export function applyAppThemePreference(
  queryClient: AppSettingsQueryClient,
  preference: AppThemePreference,
): boolean {
  if (typeof localStorage === "undefined") return false;

  const cached = queryClient.getQueryData(APP_SETTINGS_QUERY_KEY);
  const next = mergeAppSettingsTheme(cached ?? readStoredAppSettings(), preference);
  queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, next);
  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return true;
}
