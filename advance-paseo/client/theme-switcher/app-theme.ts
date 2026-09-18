// Applies theme preferences through the app's own settings pipeline.
//
// Authority model (verified against the host bundle): the app's appearance
// preference lives in a react-query cache entry keyed ["app-settings"] in an
// APP-OWNED QueryClient, mirrored to localStorage under "app-settings". The
// AppearanceProvider re-applies the theme (runtime setTheme / plugin
// updateTheme) whenever that cache entry changes, and every plugin
// installation gets its OWN isolated QueryClient — a patch written through
// useQueryClient() from plugin code lands in a cache nobody observes, and a
// bare <html> class flip gets overwritten the next time the app re-applies
// its (stale) cached preference. Both dead ends were tried in production.
//
// So the switcher writes the picked theme into the APP-level cache, located
// by walking the React fiber tree from #root: breadth-first, the app-level
// QueryClientProvider sits near the root while per-plugin providers sit
// deeper, and only the app-level client's cache actually holds the
// ["app-settings"] document. Writing there makes the APP apply the theme
// through its own mechanism — runtime state, variables, literal-colored
// layers, everything. localStorage is updated with the same document for
// restart persistence. When the walk cannot find the app client, the
// switcher falls back to flipping the unistyles theme class on <html>
// (pluginLight/pluginDark, or a built-in name) plus the storage write; the
// app then reconciles on its next settings read or launch.

import { ALL_THEME_CLASSES, type AppThemePreference } from "./catalog";

export const APP_SETTINGS_STORAGE_KEY = "app-settings";
const APP_SETTINGS_QUERY_KEY: readonly unknown[] = ["app-settings"];

/** Structural slice of a react-query client the switcher relies on. */
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
 * shallowest-first from the fiber walk; the app-level client is recognized
 * by its cache already holding the settings document (only the app ever
 * reads ["app-settings"]). The plugin's own client is skipped — nobody
 * observes it.
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
  const holding = foreign.find(
    (candidate) => candidate.getQueryData(APP_SETTINGS_QUERY_KEY) !== undefined,
  );
  return holding ?? null;
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
const MAX_FIBER_VISITS = 30_000;

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

/** TEMPORARY observability for the fiber-walk investigation. Remove after
 * the theme-switch investigation closes. */
export interface WalkOutcome {
  readonly path: "cache" | "fallback";
  readonly candidates: number;
  readonly foreignClients: number;
  readonly holdingDocument: boolean;
}
let lastWalkOutcome: WalkOutcome | null = null;
export function getLastWalkOutcome(): WalkOutcome | null {
  return lastWalkOutcome;
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
 * The full stored settings document, so a write merges without wiping
 * unrelated fields (fonts, language, ...). Malformed storage reads as an
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
 * Built-in theme preference -> unistyles theme class on <html> (the
 * fallback path). Plugin preferences map through the contributed palette's
 * appearance; "auto" maps to no class (the OS media rules decide).
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

/** Fallback application when the app-level cache is unreachable. */
function flipThemeClass(themeClass: string | null): void {
  if (typeof document === "undefined") return;
  const classList = document.documentElement.classList;
  for (const name of ALL_THEME_CLASSES) classList.remove(name);
  if (themeClass !== null) classList.add(themeClass);
}

/**
 * Switch the active theme by writing the app's own settings pipeline:
 * merge the patch into the APP-level cache (the appearance provider
 * re-applies the theme through the host runtime — the authoritative path)
 * and persist the same document to localStorage for restart. Returns false
 * (and changes nothing) when the storage pipeline is unavailable.
 */
export function applyAppThemePreference(
  queryClient: AppSettingsQueryClient,
  preference: AppThemePreference,
  contributedAppearance: "light" | "dark",
): boolean {
  if (typeof localStorage === "undefined") return false;

  const appClient = findAppQueryClient(queryClient);
  const cached =
    appClient !== null
      ? appClient.getQueryData(APP_SETTINGS_QUERY_KEY)
      : readStoredAppSettings();
  const next = mergeAppSettingsTheme(cached ?? readStoredAppSettings(), preference);

  // TEMPORARY: record the walk outcome for the diagnostics channel.
  const candidates = collectProvidedQueryClients();
  const foreign = candidates.filter(
    (candidate) => candidate !== queryClient && isQueryClientLike(candidate),
  );
  lastWalkOutcome = {
    path: appClient !== null ? "cache" : "fallback",
    candidates: candidates.length,
    foreignClients: foreign.length,
    holdingDocument:
      foreign.find(
        (client) => (client as QueryClientLike).getQueryData(APP_SETTINGS_QUERY_KEY) !== undefined,
      ) !== undefined,
  };

  if (appClient !== null) {
    appClient.setQueryData(APP_SETTINGS_QUERY_KEY, next);
  } else {
    // The app-level client could not be located (host layout change):
    // flip the class so the visuals still apply; the app reconciles the
    // runtime state on its next theme operation or launch.
    flipThemeClass(themeClassFor(preference, contributedAppearance));
  }

  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return true;
}
