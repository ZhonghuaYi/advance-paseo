// Applies theme preferences through the host's app-settings pipeline.
//
// Paseo stores its appearance preference in localStorage under "app-settings"
// and mirrors it into a react-query cache entry keyed ["app-settings"]; the
// AppearanceProvider re-applies the theme whenever that cache entry changes.
//
// The cache write needs care: the host gives every plugin client its own
// react-query instance and provides THAT to plugin surfaces, so
// useQueryClient() inside plugin UI returns a client nobody but the plugin
// observes — a patch written there never reaches the appearance provider
// (it only lands in localStorage, applying after the next app launch). To
// apply live, this module walks the rendered React fiber tree from the app
// root and writes through the app-level QueryClientProvider instead: the
// app's own provider sits near the root and its cache already holds the
// settings document, so the shallowest provider that has read
// ["app-settings"] is the one the appearance provider watches. When the walk
// finds nothing (host layout change, native host), the write falls back to
// the injected client and the change simply applies on the next launch.

import type { AppThemePreference } from "./catalog";

export const APP_SETTINGS_STORAGE_KEY = "app-settings";
const APP_SETTINGS_QUERY_KEY: readonly unknown[] = ["app-settings"];

/** Structural slice of the injected QueryClient the switcher relies on. */
export interface AppSettingsQueryClient {
  getQueryData(queryKey: readonly unknown[]): unknown;
  setQueryData(queryKey: readonly unknown[], updater: unknown): unknown;
}

interface QueryClientLike {
  getQueryData(queryKey: readonly unknown[]): unknown;
  setQueryData(queryKey: readonly unknown[], updater: unknown): unknown;
}

function isQueryClientLike(value: unknown): value is QueryClientLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    queryCache?: unknown;
    getQueryData?: unknown;
    setQueryData?: unknown;
  };
  return (
    typeof candidate.getQueryData === "function" &&
    typeof candidate.setQueryData === "function" &&
    typeof candidate.queryCache === "object" &&
    candidate.queryCache !== null
  );
}

/**
 * Pick the client a theme patch should be written to. Candidates arrive
 * shallowest-first from the fiber walk; the app-level client is preferred
 * because its cache already holds the settings document the appearance
 * provider watches. The plugin's own client (nobody observes it) is skipped.
 */
export function pickAppQueryClient(
  candidates: readonly unknown[],
  ownClient: unknown,
): AppSettingsQueryClient | null {
  const foreign = candidates.filter(
    (candidate): candidate is QueryClientLike =>
      isQueryClientLike(candidate) && candidate !== ownClient,
  );
  if (foreign.length === 0) return null;
  return (
    foreign.find(
      (candidate) => candidate.getQueryData(APP_SETTINGS_QUERY_KEY) !== undefined,
    ) ?? foreign[0]
  );
}

/** The react-reconciler fiber fields the walk needs. */
interface FiberNode {
  child?: FiberNode | null;
  sibling?: FiberNode | null;
  memoizedProps?: unknown;
}

/** react-dom marks the createRoot container with this key prefix. */
const FIBER_CONTAINER_PREFIX = "__reactContainer$";
/** Hard cap on visited fibers; the app provider sits near the root anyway. */
const MAX_FIBER_VISITS = 4_000;

/**
 * Query clients provided anywhere in the rendered tree, shallowest first.
 * Breadth-first from the app root guarantees the app-level providers come
 * before the per-plugin providers that wrap plugin surfaces.
 */
function collectProvidedQueryClients(): readonly unknown[] {
  if (typeof document === "undefined") return [];
  const rootElement = document.getElementById("root");
  if (rootElement === null) return [];

  const container = rootElement as unknown as Record<string, unknown>;
  let rootFiber: FiberNode | null = null;
  for (const key of Object.keys(container)) {
    if (key.startsWith(FIBER_CONTAINER_PREFIX)) {
      rootFiber = container[key] as FiberNode | null;
      break;
    }
  }
  if (rootFiber === null || typeof rootFiber !== "object") return [];

  const candidates: unknown[] = [];
  const queue: FiberNode[] = [rootFiber];
  for (let index = 0; index < queue.length && index < MAX_FIBER_VISITS; index += 1) {
    const fiber = queue[index];
    const props = fiber.memoizedProps;
    if (props !== null && typeof props === "object") {
      candidates.push((props as Record<string, unknown>).client);
    }
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }
  return candidates;
}

function findAppQueryClient(ownClient: unknown): AppSettingsQueryClient | null {
  return pickAppQueryClient(collectProvidedQueryClients(), ownClient);
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
 *
 * The patch is written through the app-level query client so the change
 * applies live; the injected plugin client is only the fallback when the
 * fiber walk cannot locate it, in which case the change lands in localStorage
 * and applies on the next app launch.
 */
export function applyAppThemePreference(
  queryClient: AppSettingsQueryClient,
  preference: AppThemePreference,
): boolean {
  if (typeof localStorage === "undefined") return false;

  const target = findAppQueryClient(queryClient) ?? queryClient;
  const cached = target.getQueryData(APP_SETTINGS_QUERY_KEY);
  const next = mergeAppSettingsTheme(cached ?? readStoredAppSettings(), preference);
  target.setQueryData(APP_SETTINGS_QUERY_KEY, next);
  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return true;
}
