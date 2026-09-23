import { isTextOnlyBatch } from "../dom-nodes";
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
  /**
   * Contribute lifetimes currently sharing this controller, counted across
   * EVERY bundle instance (one per host connection). The controller dies only
   * when the last one leaves.
   */
  refCount: number;
  /**
   * INSTANCE_KEY of the bundle instance that currently owns the window's
   * wallpaper state; null while unowned (see the ownership protocol above).
   */
  ownerKey: string | null;
  interactiveOwner: boolean;
  imageVersion: number;
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

/**
 * Registry key on the style element holding `{ controller }`. The engine is
 * per-document, so the LIVE controller is resolved through the DOM — never
 * through a module variable — which is what makes sharing across bundle
 * instances work.
 */
const CONTROLLER_PROPERTY = "__paseoAdvanceController";

/**
 * Identifies THIS bundle instance (one is evaluated per host connection) as
 * a writer. Used for the ownership protocol below.
 */
const INSTANCE_KEY = `advance-${Math.random().toString(36).slice(2, 10)}`;

/** Who is trying to write engine state. */
export type WallpaperWriteOrigin = "settings" | "bootstrap";

/** Outcome of a state/image write. */
export type WallpaperWriteResult = "applied" | "deferred" | "rejected";

/**
 * Single-writer ownership over the shared engine.
 *
 * The wallpaper paints one DOM layer for the whole window, but every
 * connected host's bundle instance used to push its own persisted settings
 * at connect time — the window showed whichever host initialized last. The
 * user-facing rule is now: the window follows the CLIENT's host. Two write
 * paths implement it:
 *
 * - `"bootstrap"` (background init at host connect) may only write while
 *   the engine has NO owner yet. The first host to finish initializing —
 *   in practice the client's own daemon, which the app always connects
 *   first — owns the window; every later-connected host's background apply
 *   is rejected and never repaints the window.
 * - `"settings"` (a mounted settings screen — its component runs inside
 *   the host the user selected in the host picker) may always write and
 *   takes over ownership, so live preview works no matter which host's
 *   settings are open. Opening another host's settings deliberately
 *   re-targets the window; the previous owner is not restored afterwards.
 *
 * When the owning instance's connection goes away it releases ownership;
 * the painting stays as-is (no flash) and the next host to bootstrap —
 * e.g. the client's daemon reconnecting — may claim the window again.
 */
function canWrite(current: WallpaperController, origin: WallpaperWriteOrigin): boolean {
  if (origin === "bootstrap" && current.ownerKey === INSTANCE_KEY && current.interactiveOwner) return false;
  if (current.ownerKey === null || current.ownerKey === INSTANCE_KEY) return true;
  return origin === "settings";
}

/**
 * Resolve the one live controller for this document, or null when the engine
 * is not installed. Every public entry point goes through here so a settings
 * screen inside ANY bundle instance drives the SAME controller.
 *
 * Scans every element sharing STYLE_ID rather than getElementById: a legacy
 * orphan (pre-sharing versions attached cleanup elsewhere and could leave a
 * same-id element behind) must not shadow the live registry entry.
 */
function liveController(): WallpaperController | null {
  for (const style of document.querySelectorAll(`#${STYLE_ID}`)) {
    const handle = Reflect.get(style, CONTROLLER_PROPERTY) as
      | { readonly controller?: unknown }
      | null;
    if (handle === null || typeof handle !== "object") continue;
    const found = handle.controller;
    if (found !== null && typeof found === "object") return found as WallpaperController;
  }
  return null;
}

function styleOptionsOf(state: WallpaperEngineState) {
  return { scrim: state.scrim, accent: state.accent, blur: state.blur };
}

/**
 * Apply new engine state to the running controller: rebuild the stylesheet
 * (scrim, accent, blur), switch the detection strategy, and enable or
 * disable painting. Writes are ownership-gated (see WallpaperWriteOrigin);
 * interactive writes from a mounted settings screen claim the engine, while
 * background bootstrap writes only land on an unowned engine. No-op on
 * native hosts and before installation.
 */
export function applyWallpaperState(
  state: WallpaperEngineState,
  origin: WallpaperWriteOrigin = "settings",
): WallpaperWriteResult {
  if (typeof document === "undefined") return "deferred";
  const current = liveController();
  if (!current || current.stopped) return "deferred";
  if (!canWrite(current, origin)) return "rejected";
  if (current.ownerKey !== INSTANCE_KEY) {
    current.imageVersion += 1;
    current.interactiveOwner = false;
  }
  current.ownerKey = INSTANCE_KEY;
  if (origin === "settings") current.interactiveOwner = true;

  if (current.state.mode !== state.mode) current.modeDirty = true;
  current.state = state;
  current.style.textContent = buildWallpaperCss(styleOptionsOf(state), current.shellClasses);
  current.reschedule(0);
  return "applied";
}

/**
 * Swap the active wallpaper data URLs (light/dark slots). Blob URLs of
 * replaced images are revoked; unchanged slots keep their cached URL.
 * Ownership-gated exactly like applyWallpaperState.
 */
function setWallpaperImages(
  images: WallpaperImages,
  origin: WallpaperWriteOrigin = "settings",
): WallpaperWriteResult {
  if (typeof document === "undefined") return "deferred";
  const current = liveController();
  if (!current || current.stopped) return "deferred";
  if (!canWrite(current, origin)) return "rejected";
  current.ownerKey = INSTANCE_KEY;

  for (const mode of ["light", "dark"] as const) {
    if (current.images[mode] === images[mode]) continue;
    const blobUrl = current.blobUrls.get(mode);
    if (blobUrl !== undefined) {
      URL.revokeObjectURL(blobUrl);
      current.blobUrls.delete(mode);
    }
  }
  current.images = images;
  // Warm both slots' decode cache so the FIRST switch to a slot paints
  // instantly instead of pausing on a fresh image decode.
  for (const mode of ["light", "dark"] as const) {
    const url = wallpaperUrlFor(current, mode);
    if (url === "") continue;
    const warm = document.createElement("img");
    warm.src = url;
  }
  current.reschedule(0);
  return "applied";
}

export interface WallpaperImageRequest {
  isCurrent(): boolean;
  apply(images: WallpaperImages): boolean;
  cancel(): void;
}

/** A completion can update only the controller, owner and slots it started for. */
export function beginWallpaperImages(
  settings: WallpaperSettings,
  origin: WallpaperWriteOrigin = "settings",
): WallpaperImageRequest | null {
  if (applyWallpaperState(engineStateOf(settings), origin) !== "applied") return null;
  const current = liveController()!;
  const version = ++current.imageVersion;
  let cancelled = false;
  const isCurrent = () => !cancelled && !current.stopped && liveController() === current &&
    current.ownerKey === INSTANCE_KEY && current.imageVersion === version;
  return {
    isCurrent,
    apply(images) {
      return isCurrent() && setWallpaperImages(images, origin) === "applied";
    },
    cancel() { cancelled = true; },
  };
}

/**
 * Release this contribute lifetime's claim on the shared controller. The
 * engine is torn down only when the LAST sharer (across every bundle
 * instance) leaves. Safe to call when none exists.
 */
export function removeWallpaperEngine(): void {
  if (typeof document === "undefined") return;
  if (pendingInstallTimer !== null) {
    // Our deferred install never ran; we hold no claim to release.
    window.clearTimeout(pendingInstallTimer);
    pendingInstallTimer = null;
    return;
  }
  if (!joinedSharedEngine) return;
  joinedSharedEngine = false;
  const current = liveController();
  if (current === null) {
    purgeOrphanStyles();
    return;
  }
  // If this instance owned the window's wallpaper, release it: painting
  // stays as-is, and the next host to bootstrap (typically this client's
  // daemon reconnecting) may claim the window again.
  if (current.ownerKey === INSTANCE_KEY) {
    current.ownerKey = null;
    current.imageVersion += 1;
    current.interactiveOwner = false;
  }
  current.refCount -= 1;
  if (current.refCount > 0) return;
  const cleanup: unknown = Reflect.get(current.style, CLEANUP_PROPERTY);
  if (typeof cleanup === "function") cleanup();
}

/**
 * Earlier engine versions attached their cleanup to a hidden layer div that
 * no longer exists, so their style element can survive a reload as an
 * orphan sharing our STYLE_ID (it keeps stale rules and shadows
 * getElementById). Drop any element that still carries our id before
 * creating the fresh one; a legacy orphan's cleanup runs first so its
 * observers and timers do not leak.
 */
function purgeOrphanStyles(): void {
  for (const orphan of document.querySelectorAll(`#${STYLE_ID}`)) {
    if (!(orphan instanceof HTMLElement)) continue;
    const cleanup: unknown = Reflect.get(orphan, CLEANUP_PROPERTY);
    if (typeof cleanup === "function") cleanup();
    orphan.remove();
  }
}

/**
 * The host installs the plugin once per host connection, so the client
 * bundle (and this engine module) is evaluated once per connected host —
 * several module instances in the SAME window. Module-level singletons do
 * not work here: an earlier design kept `controller` in a module variable,
 * and each new instance's install DESTROYED the previous instance's
 * controller through the shared DOM (same STYLE_ID). Whichever instance no
 * longer owned the controller then silently no-opped every settings edit —
 * scrim and blur sliders stopped working whenever the visible settings
 * screen belonged to an earlier-connected host.
 *
 * The controller is therefore registered ON THE DOM (the style element
 * carries it under CONTROLLER_PROPERTY) and reference-counted across
 * instances: every install of an already-live engine just bumps the count,
 * every teardown just drops one claim, and only the last one out tears the
 * engine down. State writes from any instance drive the same controller.
 *
 * Refcount balance is tracked per module instance (`joinedSharedEngine` /
 * `pendingInstallTimer`): a lifetime that never managed to join — its
 * deferred install was cancelled or found nothing to join — releases
 * nothing, so it can never tear down an engine another instance still owns.
 */
/** This module instance's deferred-install timer, while one is pending. */
let pendingInstallTimer: number | null = null;
/** Whether this module instance currently holds a claim on the engine. */
let joinedSharedEngine = false;

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

  // Another instance (this or an earlier host connection) already owns the
  // document's engine: join it instead of installing a second one.
  const existing = liveController();
  if (existing !== null && !existing.stopped) {
    existing.refCount += 1;
    joinedSharedEngine = true;
    return theme;
  }

  // Unistyles configures its variables during app bootstrap; retry once in
  // case the plugin client starts first.
  if (hostExposesSurfaceVariables()) {
    installController();
    joinedSharedEngine = true;
    return theme;
  }
  const timer = window.setTimeout(() => {
    // Superseded or cancelled while pending: nothing to do.
    if (pendingInstallTimer !== timer) return;
    pendingInstallTimer = null;
    const live = liveController();
    if (live !== null && !live.stopped) {
      // Someone else installed while we waited; join their engine.
      live.refCount += 1;
      joinedSharedEngine = true;
      return;
    }
    if (hostExposesSurfaceVariables()) {
      installController();
      joinedSharedEngine = true;
    } else {
      console.error(
        "[advance-paseo] wallpaper stays dormant: the host does not expose --colors-* CSS variables",
      );
    }
  }, 1500);
  pendingInstallTimer = timer;
  return theme;
}

function installController(): void {
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
    refCount: 1,
    ownerKey: null,
    interactiveOwner: false,
    imageVersion: 0,
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
  Reflect.set(style, CONTROLLER_PROPERTY, { controller: instance });

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

  /**
   * Recompute the wallpaper slot and repaint WITHOUT the debounce. Mode
   * detection only reads the theme class on <html>, so this is cheap enough
   * to run in the observer microtask — the wallpaper swaps in the same frame
   * as the CSS-variable theme change instead of one debounce later (which
   * read as a laggy transition). Glass decoration stays on the debounce.
   */
  const updateModeNow = () => {
    if (instance.stopped) return;
    instance.mode = resolveWallpaperMode(readHostThemeSignals(), instance.state.mode);
    instance.modeDirty = false;
    const detected = instance.mode;
    const effectiveMode =
      instance.state.enabled && detected !== null && instance.images[detected] !== null
        ? detected
        : null;
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
    // Theme class changes land on <html>, outside #root.
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
    // The theme class flip lands on <html>: repaint the wallpaper slot in
    // the same frame as the host's variable-driven recolor.
    if (
      records.some(
        (record) => record.type === "attributes" && record.target === document.documentElement,
      )
    ) {
      updateModeNow();
    } else if (records.some((record) => record.type === "attributes")) {
      instance.modeDirty = true;
    }
    schedule(UPDATE_DEBOUNCE_MS);
  });
  observeRoot();

  const prefersDarkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSchemeChange = () => {
    // "auto" mode follows the OS preference; same-frame repaint like a
    // class flip.
    updateModeNow();
    schedule(UPDATE_DEBOUNCE_MS);
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
    // Removing the style element also drops the DOM registry entry.
    instance.refCount = 0;
    style.remove();
  };
  Reflect.set(style, CLEANUP_PROPERTY, cleanup);
}

export function readHostThemeSignals(): HostThemeSignals {
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
 * they track --colors-background plus one constant #f2f2f2 light layer.
 * They would sit above the canvas and hide the base
 * coat.
 *
 * Narrow gates keep content cards out: only elements covering at least half
 * the viewport, fully opaque, not raised above the layout (z-index auto or 0
 * — real overlays use higher values), and painting a window-base color (any
 * registered theme's background token, or the app's constant light base).
 * Elevated surfaces like the permission card (surface1) never match the
 * color gate.
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

/**
 * Window-base paints a cover layer can show: the app's constant light base
 * (#f2f2f2, host bundle), the live theme's background token, AND every other
 * registered theme's background. The roam matters because the theme
 * the host flips the <html> class: CSS variables follow instantly, but
 * layers painted from JS theme values (RN Web atomic classes with literal
 * colors) keep the PREVIOUS theme's paint until the app reconciles — the
 * gate must recognize that stale color too, or the wallpaper stays hidden
 * after every switch away from whichever theme matched at startup.
 */
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
    // Fall through to the sheet scan for the registered values.
  }
  for (const value of collectThemeBackgroundValues()) {
    const rgb = hexToRgbString(value);
    if (rgb !== null) colors.add(rgb);
  }
  return colors;
}

/** Every --colors-background value defined across the host's per-theme
 * `:root.<name>` rules (theme classes are all on <html>, so one scan of the
 * sheet sees them all regardless of the active theme). */
function collectThemeBackgroundValues(): readonly string[] {
  const tag = document.getElementById("unistyles-web");
  if (tag === null) return [];
  const sheet = (
    tag as unknown as { readonly sheet?: { readonly cssRules: readonly HostStyleRule[] | null } }
  ).sheet;
  const values: string[] = [];
  const walk = (rules: readonly HostStyleRule[] | null): void => {
    if (rules === null) return;
    for (const rule of rules) {
      const match = /--colors-background:\s*([^;]+);/u.exec(rule.cssText);
      if (match !== null) values.push(match[1].trim());
      walk(rule.cssRules ?? null);
    }
  };
  walk(sheet?.cssRules ?? null);
  return values;
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
  const doc = document.documentElement;
  // Self-heal: the appliedKey cache only shortcuts when the DOM actually
  // agrees. Parallel installations (before the shared-instance fix) or any
  // external writer can strip these attributes; trusting the cache alone
  // then left the wallpaper off forever. Verifying is two cheap reads.
  const domAgrees =
    mode === null
      ? doc.getAttribute(ROOT_ATTRIBUTE) === null
      : doc.getAttribute(ROOT_ATTRIBUTE) === mode &&
        doc.style.getPropertyValue(IMAGE_PROPERTY) !== "";
  if (key === instance.appliedKey && domAgrees) return;
  instance.appliedKey = key;

  if (mode === null) {
    doc.removeAttribute(ROOT_ATTRIBUTE);
    doc.style.removeProperty(IMAGE_PROPERTY);
    return;
  }

  doc.setAttribute(ROOT_ATTRIBUTE, mode);
  doc.style.setProperty(IMAGE_PROPERTY, `url("${url}")`);
}
