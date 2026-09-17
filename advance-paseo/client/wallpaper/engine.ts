// Web/Electron wallpaper controller for the Advance Paseo plugin.
//
// Architecture (see wallpaper-css.ts for the visual half): the wallpaper
// paints once as a base coat on <html>, and the host's full-bleed surface
// colors are redirected to transparent by overriding the CSS variables
// react-native-unistyles emits (--colors-surface0/-sidebar/-workspace).
// Existence of the wallpaper therefore no longer depends on discovering
// individual DOM surfaces: every screen shows the base coat by
// construction, and nothing a view switch can do (unmounts, splash frames,
// multi-commit route swaps) can flash it away.
//
// What remains dynamic: (a) resolving the light/dark slot from the host's
// theme class on <html> (theme-detect.ts), (b) swapping the image when the
// slot or the stored pictures change, and (c) marking the few glass
// surfaces (sidebars, tab strip, settings cards) that get backdrop-filter
// refinement. Missing a glass mark costs blur, never the wallpaper itself.
//
// Capability gate: if the host ever stops exposing --colors-* variables,
// the engine stays dormant (the plain color themes still work) instead of
// injecting a stylesheet that cannot have its intended effect.
//
// Performance contract: streamed assistant tokens land inside already-marked
// glass shells where plain CSS selectors style them, so mutation batches
// that only shuffle text nodes are ignored; everything else — including the
// theme-class flip on <html> — runs through a trailing debounce with a
// max-wait guarantee.

import type { PluginThemeContribution } from "@getpaseo/plugin";
import { WALLPAPER_SETTINGS_DEFAULTS, type WallpaperSettings } from "../../shared/wallpaper";
import { parseRgba } from "./palettes";
import {
  resolveWallpaperMode,
  type HostThemeSignals,
  type WallpaperMode,
} from "./theme-detect";
import {
  buildWallpaperCss,
  CLEANUP_PROPERTY,
  IMAGE_PROPERTY,
  OPAQUE_COVER_ATTRIBUTE,
  RIGHT_SIDEBAR_ATTRIBUTE,
  ROOT_ATTRIBUTE,
  SETTINGS_CARD_ATTRIBUTE,
  SETTINGS_SIDEBAR_ATTRIBUTE,
  STYLE_ID,
  WORKSPACE_SIDEBAR_ATTRIBUTE,
  WORKSPACE_TABS_ATTRIBUTE,
} from "./wallpaper-css";

const WORKSPACE_SIDEBAR_ANCHORS = [
  '[data-testid="sidebar-project-list"]',
  '[data-testid="sidebar-project-workspace-list-scroll"]',
  '[data-testid="sidebar-status-list-scroll"]',
  '[data-testid="sidebar-pinned-list"]',
  '[data-testid="sidebar-global-new-workspace"]',
  '[data-testid="sidebar-sessions"]',
  '[data-testid="sidebar-search"]',
  '[data-testid="left-sidebar-resize-handle"]',
].join(", ");

/** Built-in unistyles theme classes on <html> that name the dark family. */
const BUILTIN_DARK_THEME_CLASSES: readonly string[] = [
  "dark",
  "darkZinc",
  "darkMidnight",
  "darkClaude",
  "darkGhostty",
  "darkPureBlack",
];

/** Trailing debounce for mutation batches. */
const UPDATE_DEBOUNCE_MS = 120;
/** Decoration is guaranteed to run within this window of the first pending signal. */
const UPDATE_MAX_WAIT_MS = 480;

/** Engine-relevant projection of the wallpaper settings document. */
export interface WallpaperEngineState {
  readonly enabled: boolean;
  readonly mode: WallpaperSettings["mode"];
  readonly scrim: WallpaperSettings["scrim"];
  readonly blur: WallpaperSettings["blur"];
  readonly accent: WallpaperSettings["accent"];
}

export const DEFAULT_ENGINE_STATE: WallpaperEngineState = {
  enabled: WALLPAPER_SETTINGS_DEFAULTS.enabled,
  mode: WALLPAPER_SETTINGS_DEFAULTS.mode,
  scrim: WALLPAPER_SETTINGS_DEFAULTS.scrim,
  blur: WALLPAPER_SETTINGS_DEFAULTS.blur,
  accent: WALLPAPER_SETTINGS_DEFAULTS.accent,
};

export function engineStateOf(settings: WallpaperSettings): WallpaperEngineState {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    scrim: settings.scrim,
    blur: settings.blur,
    accent: settings.accent,
  };
}

export interface WallpaperImages {
  readonly light: string | null;
  readonly dark: string | null;
}

interface WallpaperController {
  readonly style: HTMLElement;
  readonly decorated: Set<HTMLElement>;
  /** Discovered host classes that paint full-bleed surface0 shells. */
  shellClasses: string[];
  state: WallpaperEngineState;
  images: WallpaperImages;
  /** Cached detection result; recomputed only while `modeDirty` is set. */
  mode: WallpaperMode | null;
  modeDirty: boolean;
  /** Cache key (mode + image URL) of what is written to the DOM right now. */
  appliedKey: string | null;
  blobUrls: Map<WallpaperMode, string>;
  timer: number | null;
  maxWaitTimer: number | null;
  stopped: boolean;
  headObserver: MutationObserver;
  rootObserver: MutationObserver;
  /** Schedule a throttled update; assigned during installation. */
  reschedule: (delay: number) => void;
}

let controller: WallpaperController | null = null;

function styleOptionsOf(state: WallpaperEngineState) {
  return { scrim: state.scrim, accent: state.accent, blur: state.blur };
}

/**
 * Apply new engine state to the running controller: rebuild the stylesheet
 * (scrim, accent, blur), switch the detection strategy, and enable or
 * disable painting. No-op on native hosts and before installation.
 */
export function applyWallpaperState(state: WallpaperEngineState): void {
  if (typeof document === "undefined") return;
  const current = controller;
  if (!current || current.stopped) return;

  if (current.state.mode !== state.mode) current.modeDirty = true;
  current.state = state;
  current.style.textContent = buildWallpaperCss(styleOptionsOf(state), current.shellClasses);
  current.reschedule(0);
}

/**
 * Swap the active wallpaper data URLs (light/dark slots). Blob URLs of
 * replaced images are revoked; unchanged slots keep their cached URL.
 */
export function setWallpaperImages(images: WallpaperImages): void {
  if (typeof document === "undefined") return;
  const current = controller;
  if (!current || current.stopped) return;

  for (const mode of ["light", "dark"] as const) {
    if (current.images[mode] === images[mode]) continue;
    const blobUrl = current.blobUrls.get(mode);
    if (blobUrl !== undefined) {
      URL.revokeObjectURL(blobUrl);
      current.blobUrls.delete(mode);
    }
  }
  current.images = images;
  current.reschedule(0);
}

/** Remove any installed wallpaper controller. Safe to call when none exists. */
export function removeWallpaperEngine(): void {
  if (typeof document === "undefined") return;
  const style = document.getElementById(STYLE_ID);
  const cleanup: unknown = style ? Reflect.get(style, CLEANUP_PROPERTY) : null;
  if (typeof cleanup === "function") cleanup();
}

/**
 * Earlier engine versions attached their cleanup to a hidden layer div that
 * no longer exists, so their style element can survive a reload as an
 * orphan sharing our STYLE_ID (it keeps stale rules and shadows
 * getElementById). Drop any element that still carries our id before
 * creating the fresh one.
 */
function purgeOrphanStyles(): void {
  for (const orphan of document.querySelectorAll(`#${STYLE_ID}`)) {
    if (orphan instanceof HTMLElement) orphan.remove();
  }
}

/**
 * The whole architecture rides on the host exposing its surface colors as
 * CSS variables; without them the stylesheet cannot make surfaces
 * transparent and the engine must stay dormant.
 */
function hostExposesSurfaceVariables(): boolean {
  try {
    return (
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--colors-surface0")
        .trim() !== ""
    );
  } catch {
    return false;
  }
}

/**
 * Install a self-cleaning wallpaper controller while returning the untouched
 * theme contribution expected by client.addTheme().
 */
export function installWallpaperEngine(
  theme: PluginThemeContribution,
): PluginThemeContribution {
  if (typeof document === "undefined") return theme;

  removeWallpaperEngine();

  // Unistyles configures its variables during app bootstrap; retry once in
  // case the plugin client starts first.
  if (hostExposesSurfaceVariables()) {
    installController();
    return theme;
  }
  window.setTimeout(() => {
    if (hostExposesSurfaceVariables()) {
      installController();
    } else {
      console.error(
        "[advance-paseo] wallpaper stays dormant: the host does not expose --colors-* CSS variables",
      );
    }
  }, 1500);
  return theme;
}

function installController(): void {
  removeWallpaperEngine();
  purgeOrphanStyles();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildWallpaperCss(styleOptionsOf(DEFAULT_ENGINE_STATE));
  document.head.append(style);

  const instance: WallpaperController = {
    style,
    decorated: new Set(),
    shellClasses: [],
    state: DEFAULT_ENGINE_STATE,
    images: { light: null, dark: null },
    mode: null,
    modeDirty: true,
    appliedKey: null,
    blobUrls: new Map(),
    timer: null,
    maxWaitTimer: null,
    stopped: false,
    headObserver: null as unknown as MutationObserver,
    rootObserver: null as unknown as MutationObserver,
    reschedule: () => {},
  };
  controller = instance;

  const refreshShellClasses = () => {
    const discovered = discoverSurface0ShellClasses();
    if (
      discovered.length !== instance.shellClasses.length ||
      discovered.some((token, index) => token !== instance.shellClasses[index])
    ) {
      instance.shellClasses = discovered;
      instance.style.textContent = buildWallpaperCss(
        styleOptionsOf(instance.state),
        instance.shellClasses,
      );
    }
  };

  const update = () => {
    clearTimers(instance);
    if (instance.stopped) return;

    // Theme changes rewrite the host stylesheet; the shell classes are
    // content hashes and normally stable, but re-scan is cheap.
    refreshShellClasses();

    clearDecorations(instance.decorated);

    if (instance.modeDirty) {
      instance.mode = resolveWallpaperMode(readHostThemeSignals(), instance.state.mode);
      instance.modeDirty = false;
    }

    const detected = instance.mode;
    const effectiveMode =
      instance.state.enabled && detected !== null && instance.images[detected] !== null
        ? detected
        : null;
    if (effectiveMode !== null) decorateGlassSurfaces(instance.decorated);
    applyMode(instance, effectiveMode);
  };

  const schedule = (delay: number) => {
    if (instance.stopped) return;
    if (instance.timer !== null) window.clearTimeout(instance.timer);
    // Guarantee an update even when a continuous stream keeps resetting the
    // trailing debounce.
    if (instance.maxWaitTimer === null) {
      instance.maxWaitTimer = window.setTimeout(() => {
        instance.maxWaitTimer = null;
        update();
      }, UPDATE_MAX_WAIT_MS);
    }
    instance.timer = window.setTimeout(() => {
      instance.timer = null;
      update();
    }, delay);
  };
  instance.reschedule = schedule;

  const observeRoot = () => {
    const root = document.getElementById("root");
    if (!root) return;
    instance.rootObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    // Theme switches flip a class directly on <html> — outside #root.
    instance.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  // Head carries the host's unistyles stylesheet; a theme change rewrites
  // it, which is a second signal that the active theme may have changed.
  instance.headObserver = new MutationObserver(() => {
    instance.modeDirty = true;
    schedule(150);
  });
  instance.headObserver.observe(document.head, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  instance.rootObserver = new MutationObserver((records) => {
    // Streaming re-renders only shuffle text nodes inside glass shells and
    // can never mount or restyle one, so they are ignored outright.
    if (isTextOnlyBatch(records)) return;
    if (records.some((record) => record.type === "attributes")) {
      instance.modeDirty = true;
    }
    schedule(UPDATE_DEBOUNCE_MS);
  });
  observeRoot();

  const prefersDarkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSchemeChange = () => {
    instance.modeDirty = true;
    schedule(180);
  };
  const handleResize = () => {
    // Sidebar geometry (which element is the workspace rail) depends on the
    // viewport shape.
    schedule(180);
  };
  prefersDarkMedia.addEventListener("change", handleSchemeChange);
  window.addEventListener("resize", handleResize);

  // Detect the applied theme immediately and retry after the host restores
  // its persisted appearance preference.
  update();
  const startupTimer = window.setTimeout(() => {
    instance.modeDirty = true;
    schedule(0);
  }, 600);

  const cleanup = () => {
    if (instance.stopped) return;
    instance.stopped = true;
    clearTimers(instance);
    window.clearTimeout(startupTimer);
    instance.headObserver.disconnect();
    instance.rootObserver.disconnect();
    prefersDarkMedia.removeEventListener("change", handleSchemeChange);
    window.removeEventListener("resize", handleResize);
    document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
    document.documentElement.style.removeProperty(IMAGE_PROPERTY);
    clearDecorations(instance.decorated);
    for (const url of instance.blobUrls.values()) URL.revokeObjectURL(url);
    instance.blobUrls.clear();
    style.remove();
    controller = null;
  };
  Reflect.set(style, CLEANUP_PROPERTY, cleanup);
}

function readHostThemeSignals(): HostThemeSignals {
  const classList = document.documentElement.classList;
  const pluginTheme = classList.contains("pluginLight")
    ? "light"
    : classList.contains("pluginDark")
      ? "dark"
      : null;
  const builtinTheme = classList.contains("light")
    ? "light"
    : BUILTIN_DARK_THEME_CLASSES.some((name) => classList.contains(name))
      ? "dark"
      : null;
  return {
    pluginTheme,
    builtinTheme,
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  };
}

function clearTimers(target: WallpaperController): void {
  if (target.timer !== null) {
    window.clearTimeout(target.timer);
    target.timer = null;
  }
  if (target.maxWaitTimer !== null) {
    window.clearTimeout(target.maxWaitTimer);
    target.maxWaitTimer = null;
  }
}

function isTextOnlyBatch(records: readonly MutationRecord[]): boolean {
  if (records.length === 0) return false;
  return records.every(
    (record) =>
      record.type === "childList" &&
      containsNoElements(record.addedNodes) &&
      containsNoElements(record.removedNodes),
  );
}

function containsNoElements(nodes: readonly unknown[]): boolean {
  return nodes.every((node) => !(node instanceof HTMLElement));
}

function clearDecorations(elements: Set<HTMLElement>): void {
  for (const element of elements) {
    element.removeAttribute(WORKSPACE_SIDEBAR_ATTRIBUTE);
    element.removeAttribute(RIGHT_SIDEBAR_ATTRIBUTE);
    element.removeAttribute(WORKSPACE_TABS_ATTRIBUTE);
    element.removeAttribute(SETTINGS_SIDEBAR_ATTRIBUTE);
    element.removeAttribute(SETTINGS_CARD_ATTRIBUTE);
    element.removeAttribute(OPAQUE_COVER_ATTRIBUTE);
  }
  elements.clear();
}

function findWorkspaceSidebarSurface(anchor: HTMLElement): HTMLElement | null {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const maximumWidth = Math.min(520, viewportWidth * 0.46);
  const minimumHeight = Math.max(360, viewportHeight * 0.65);
  let current: HTMLElement | null = anchor;
  let surface: HTMLElement | null = null;

  while (current && current !== document.body) {
    const rect = current.getBoundingClientRect();
    const isSidebarSized =
      rect.width >= 150 && rect.width <= maximumWidth && rect.left <= viewportWidth * 0.2;
    const isTallEnough = rect.height >= minimumHeight;

    if (isSidebarSized && isTallEnough) {
      surface = current;
    }

    // Once the ancestor becomes the full app row/root, continuing would mark
    // the entire workspace instead of the left workspace bar.
    if (rect.width > viewportWidth * 0.6) {
      break;
    }
    current = current.parentElement;
  }

  return surface;
}

/**
 * Mark the glass surfaces: the workspace left rail (discovered geometrically
 * — its wrapper has no stable test id), the explorer dock, the tab strip,
 * the settings sidebar, and host settings cards (card fingerprint). All of
 * these only refine the always-painted base coat with blur and tints, so a
 * missed or late mark costs refinement, never the wallpaper.
 */
function decorateGlassSurfaces(elements: Set<HTMLElement>): void {
  const root = document.getElementById("root");
  if (!root) return;

  markOpaqueCovers(root, elements);

  const sidebarAnchor = root.querySelector<HTMLElement>(WORKSPACE_SIDEBAR_ANCHORS);
  const workspaceSidebar = sidebarAnchor
    ? findWorkspaceSidebarSurface(sidebarAnchor)
    : null;
  if (workspaceSidebar) {
    workspaceSidebar.setAttribute(WORKSPACE_SIDEBAR_ATTRIBUTE, "");
    elements.add(workspaceSidebar);
  }

  for (const sidebar of root.querySelectorAll<HTMLElement>(
    '[data-testid="workspace-explorer-sidebar"]',
  )) {
    sidebar.setAttribute(RIGHT_SIDEBAR_ATTRIBUTE, "");
    elements.add(sidebar);
  }

  for (const tabs of root.querySelectorAll<HTMLElement>('[data-testid="workspace-tabs-row"]')) {
    tabs.setAttribute(WORKSPACE_TABS_ATTRIBUTE, "");
    elements.add(tabs);
  }

  for (const sidebar of root.querySelectorAll<HTMLElement>(
    '[data-testid="settings-sidebar"]',
  )) {
    sidebar.setAttribute(SETTINGS_SIDEBAR_ATTRIBUTE, "");
    elements.add(sidebar);
  }

  for (const pane of root.querySelectorAll<HTMLElement>(
    '[data-testid="settings-detail-pane"]',
  )) {
    markHostSettingsCards(pane, elements);
  }
}

/** Unistyles rule shape the engine walks when discovering shells. */
interface HostStyleRule {
  readonly selectorText?: string;
  readonly cssText: string;
  readonly cssRules?: readonly HostStyleRule[] | null;
}

/**
 * Discover the host classes that paint full-bleed surface0 shells. The host
 * compiles themed styles into `.unistyles_<hash>` classes whose values are
 * var(--colors-*) references; a SHELL combines a full-bleed layout property
 * (flex / flex-grow / height 100%) with background var(--colors-surface0).
 * Redirecting the variable itself would also empty popup lists (e.g. the
 * host picker) and small controls that fill with surface0, so only these
 * class rules are made transparent — popup-shaped surface0 rules keep their
 * paint.
 */
function discoverSurface0ShellClasses(): string[] {
  const tag = document.getElementById("unistyles-web");
  if (tag === null) return [];
  const sheet = (tag as unknown as { readonly sheet?: { readonly cssRules: readonly HostStyleRule[] | null } })
    .sheet;
  const classes: string[] = [];
  const walk = (rules: readonly HostStyleRule[] | null): void => {
    if (rules === null) return;
    for (const rule of rules) {
      const selector = rule.selectorText;
      if (
        selector !== undefined &&
        /^\.[a-z0-9_-]+$/u.test(selector) &&
        rule.cssText.includes("var(--colors-surface0)") &&
        /flex:\s*1|flex-grow:\s*1|height:\s*100%/.test(rule.cssText)
      ) {
        classes.push(selector.slice(1));
      }
      walk(rule.cssRules ?? null);
    }
  };
  walk(sheet?.cssRules ?? null);
  return classes;
}

/**
 * Clear root-level covers: full-viewport layers the host paints with a solid
 * window-base color OUTSIDE the CSS-variable redirects (RN Web atomic
 * classes with literal values — the theme's window-background snapshots;
 * diagnostics showed them tracking --colors-background plus one constant
 * #f2f2f2 light layer). They would sit above the canvas and hide the base
 * coat.
 *
 * Narrow gates keep content cards out: only elements covering at least half
 * the viewport, fully opaque, not raised above the layout (z-index auto or 0
 * — real overlays use higher values), and painting exactly a window-base
 * color (the live --colors-background value or the app's constant light
 * base). Elevated surfaces like the permission card (surface1) never match
 * the color gate.
 */
function markOpaqueCovers(root: HTMLElement, elements: Set<HTMLElement>): void {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const windowBaseColors = collectWindowBaseColors();
  for (const candidate of root.querySelectorAll<HTMLElement>("div")) {
    if (candidate.hasAttribute(OPAQUE_COVER_ATTRIBUTE)) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width * rect.height < viewportArea * 0.5) continue;

    const style = window.getComputedStyle(candidate);
    if (style.position === "fixed") continue;
    if (style.zIndex !== "auto" && style.zIndex !== "0") continue;
    if (!windowBaseColors.has(style.backgroundColor)) continue;

    candidate.setAttribute(OPAQUE_COVER_ATTRIBUTE, "");
    elements.add(candidate);
  }
}

/** Window-base paints: the live theme background token plus the app's
 * constant light base (#f2f2f2, verified against the host bundle). */
function collectWindowBaseColors(): Set<string> {
  const colors = new Set<string>(["rgb(242, 242, 242)"]);
  try {
    const background = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--colors-background")
      .trim();
    const rgb = background !== "" ? hexToRgbString(background) : null;
    if (rgb !== null) colors.add(rgb);
  } catch {
    // Keep the constant fallback.
  }
  return colors;
}

function hexToRgbString(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}

/** Host SettingsCard fingerprint: content-wide, 8px radius, hairline border,
 * fully opaque background. Radius and border come straight from the host kit's
 * settingsStyles (borderRadius.lg = 8, borderWidth 1), which keeps buttons,
 * inputs, and row controls out of the match. */
function markHostSettingsCards(pane: HTMLElement, elements: Set<HTMLElement>): void {
  for (const candidate of pane.querySelectorAll<HTMLElement>("div")) {
    if (candidate.hasAttribute(SETTINGS_CARD_ATTRIBUTE)) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width < 240 || rect.height < 36) continue;

    const style = window.getComputedStyle(candidate);
    if (style.borderRadius !== "8px") continue;
    if (style.borderTopWidth !== "1px") continue;
    const color = parseRgba(style.backgroundColor);
    if (!color || color[3] < 0.95) continue;

    candidate.setAttribute(SETTINGS_CARD_ATTRIBUTE, "");
    elements.add(candidate);
  }
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
  if (
    typeof Blob === "undefined" ||
    typeof atob !== "function" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;

  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: match[1] }));
  } catch {
    return null;
  }
}

/** Lazily convert only the active mode's wallpaper; the other stays unbuilt. */
function wallpaperUrlFor(instance: WallpaperController, mode: WallpaperMode): string {
  const existing = instance.blobUrls.get(mode);
  if (existing !== undefined) return existing;

  const dataUrl = instance.images[mode];
  if (dataUrl === null) return "";
  // Data URLs of real wallpapers exceed Chromium's roughly 2 MiB URL
  // ceiling. Blob URLs keep every source byte while giving CSS a short URL.
  const url = dataUrlToBlobUrl(dataUrl);
  if (url === null) return dataUrl;
  instance.blobUrls.set(mode, url);
  return url;
}

function applyMode(instance: WallpaperController, mode: WallpaperMode | null): void {
  const url = mode === null ? "" : wallpaperUrlFor(instance, mode);
  const key = mode === null ? "off" : `${mode}:${url}`;
  if (key === instance.appliedKey) return;
  instance.appliedKey = key;

  if (mode === null) {
    document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
    document.documentElement.style.removeProperty(IMAGE_PROPERTY);
    return;
  }

  document.documentElement.setAttribute(ROOT_ATTRIBUTE, mode);
  document.documentElement.style.setProperty(IMAGE_PROPERTY, `url("${url}")`);
}
