// Web/Electron wallpaper controller for the Advance Paseo plugin.
//
// Paseo applies themes through React Native, which leaves no stylesheet hook
// for background images, so this module installs a hidden layer plus a style
// element and marks the structural shells (chat surfaces, workspace sidebars,
// tab rows) that should paint the wallpaper. Marking survives host re-renders
// through a MutationObserver-driven decorator.
//
// Unlike the Miku plugin it descends from, the wallpaper image is not bundled:
// the client resolves the active light/dark data URLs through plugin RPCs and
// hands them to setWallpaperImages(); they are converted to Blob URLs so CSS
// can reference them past Chromium's data-URL length ceiling. Mode detection
// has two strategies (see theme-detect.ts) selected by the "mode" setting.
//
// Performance contract: streamed assistant tokens land inside already-marked
// shells where plain CSS selectors style them, so mutation batches that only
// shuffle text nodes are ignored, the detected light/dark mode is cached and
// only re-derived when the theme signal changes (head mutations, class flips,
// menu interactions, resize), and updates are throttled with a max-wait so a
// continuous stream cannot starve decoration indefinitely.

import type { PluginThemeContribution } from "@getpaseo/plugin";
import { WALLPAPER_SETTINGS_DEFAULTS, type WallpaperSettings } from "../../shared/wallpaper";
import {
  classifyLuminanceMode,
  classifyMarkerMode,
  type SurfaceSample,
  type WallpaperMode,
} from "./theme-detect";
import { parseRgba, type WallpaperStyleOptions } from "./palettes";
import {
  buildWallpaperCss,
  CHAT_CLEAR_ATTRIBUTE,
  CHAT_SURFACE_ATTRIBUTE,
  CLEANUP_PROPERTY,
  IMAGE_PROPERTY,
  LAYER_ID,
  RIGHT_SIDEBAR_ATTRIBUTE,
  ROOT_ATTRIBUTE,
  SETTINGS_SIDEBAR_ATTRIBUTE,
  SETTINGS_SURFACE_ATTRIBUTE,
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

/** Trailing debounce for mutation batches. */
const UPDATE_DEBOUNCE_MS = 120;
/** Decoration is guaranteed to run within this window of the first pending signal. */
const UPDATE_MAX_WAIT_MS = 480;
/** Hard cap on elements inspected per mode detection. */
const DETECTION_ELEMENT_CAP = 700;

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
  readonly layer: HTMLDivElement;
  readonly style: HTMLElement;
  readonly decorated: Set<HTMLElement>;
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
  rootObserver: MutationObserver | null;
  rootObserved: boolean;
  /** Schedule a throttled update; assigned during installation. */
  reschedule: (delay: number) => void;
}

let controller: WallpaperController | null = null;

const stateListeners = new Set<(state: WallpaperEngineState) => void>();

function styleOptionsOf(state: WallpaperEngineState): WallpaperStyleOptions {
  return { scrim: state.scrim, accent: state.accent, blur: state.blur };
}

/** Current applied engine state (defaults before install or on native hosts). */
export function getWallpaperState(): WallpaperEngineState {
  return controller?.state ?? DEFAULT_ENGINE_STATE;
}

/** Subscribe to engine state changes; returns an idempotent unsubscribe. */
export function onWallpaperStateChanged(
  listener: (state: WallpaperEngineState) => void,
): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
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
  current.style.textContent = buildWallpaperCss(styleOptionsOf(state));
  for (const listener of stateListeners) listener(state);
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
  const layer = document.getElementById(LAYER_ID);
  const cleanup: unknown = layer ? Reflect.get(layer, CLEANUP_PROPERTY) : null;
  if (typeof cleanup === "function") cleanup();
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

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildWallpaperCss(styleOptionsOf(DEFAULT_ENGINE_STATE));

  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  layer.setAttribute("aria-hidden", "true");
  document.head.append(style);
  document.body.prepend(layer);

  const instance: WallpaperController = {
    layer,
    style,
    decorated: new Set(),
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
    rootObserver: null,
    rootObserved: false,
    reschedule: () => {},
  };
  controller = instance;

  const update = () => {
    clearTimers(instance);
    if (instance.stopped) return;
    // Paseo normally mounts #root before plugins load; attach lazily if not.
    observeRoot();

    // Clear decorations BEFORE reading computed colors: the chat-clear path
    // paints ancestors transparent, which would otherwise hide the very theme
    // markers the detector matches and make the detected mode oscillate.
    clearDecorations(instance.decorated);

    if (instance.modeDirty) {
      instance.mode = detectMode(instance.state.mode);
      instance.modeDirty = false;
    }

    const detected = instance.mode;
    const effectiveMode =
      instance.state.enabled && detected !== null && instance.images[detected] !== null
        ? detected
        : null;
    if (effectiveMode !== null) {
      decorateChatSurfaces(instance.decorated);
      decorateWorkspaceChrome(instance.decorated);
      decorateSettingsSurfaces(instance.decorated);
    }
    // Apply after decorating so a fresh decoration paints against the mode
    // the CSS expects, and skip DOM writes when nothing changed.
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
    if (instance.rootObserver === null || instance.rootObserved) return;
    const root = document.getElementById("root");
    if (!root) return;
    instance.rootObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    instance.rootObserved = true;
  };

  // Head carries the host's theme styles; changes there are the primary
  // signal that the active theme may have changed. characterData is skipped:
  // in-place text edits in head are things like <title> updates, while
  // stylesheet edits arrive as childList mutations.
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
    // Streaming re-renders only shuffle text nodes inside marked shells.
    // Text-only batches can never mount a pane, sidebar, or composer, so
    // they are ignored outright.
    if (isTextOnlyBatch(records)) return;
    if (records.some((record) => record.type === "attributes")) {
      instance.modeDirty = true;
    }
    schedule(UPDATE_DEBOUNCE_MS);
  });
  observeRoot();

  const handleInteraction = () => {
    instance.modeDirty = true;
    schedule(180);
  };
  const handleKeyboardInteraction = (event: KeyboardEvent) => {
    // Theme menus can be operated with these keys. Ignore ordinary typing so
    // composing a message never causes repeated style scans.
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "Escape" ||
      event.key === "Tab"
    ) {
      handleInteraction();
    }
  };
  const handleResize = () => {
    // Shell selection and detection weighting depend on viewport geometry.
    instance.modeDirty = true;
    schedule(180);
  };
  document.addEventListener("click", handleInteraction, true);
  document.addEventListener("keyup", handleKeyboardInteraction, true);
  window.addEventListener("resize", handleResize);

  // Detect an already-applied theme immediately, retry after Paseo restores
  // the persisted appearance preference, and pick up a late-mounted #root.
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
    instance.rootObserver?.disconnect();
    document.removeEventListener("click", handleInteraction, true);
    document.removeEventListener("keyup", handleKeyboardInteraction, true);
    window.removeEventListener("resize", handleResize);
    document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
    document.documentElement.style.removeProperty(IMAGE_PROPERTY);
    clearDecorations(instance.decorated);
    for (const url of instance.blobUrls.values()) URL.revokeObjectURL(url);
    instance.blobUrls.clear();
    style.remove();
    layer.remove();
    controller = null;
  };
  Reflect.set(layer, CLEANUP_PROPERTY, cleanup);

  return theme;

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

/** Sample the painted surfaces once; both strategies share this pass. */
function collectSamples(): SurfaceSample[] {
  const root = document.getElementById("root");
  if (!root) return [];

  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const elements = [
    root,
    ...root.querySelectorAll<HTMLElement>("div, main, section, aside"),
  ];
  const samples: SurfaceSample[] = [];

  const limit = Math.min(elements.length, DETECTION_ELEMENT_CAP);
  for (let index = 0; index < limit; index += 1) {
    const element = elements[index];
    // The conversation receives our background CSS. Excluding it keeps the
    // enhancement from becoming evidence for itself after a theme change.
    if (element.matches('[data-testid="agent-chat-scroll"]')) continue;
    const rect = element.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < 4_000) continue;

    const color = parseRgba(window.getComputedStyle(element).backgroundColor);
    if (!color) continue;
    const weight = Math.min(4, Math.max(1, Math.round((area / viewportArea) * 8)));
    samples.push({ color, weight });
  }
  return samples;
}

function detectMode(strategy: WallpaperEngineState["mode"]): WallpaperMode | null {
  const samples = collectSamples();
  if (samples.length === 0) return null;
  if (strategy === "system") {
    // "System themes only": the wallpaper is off while one of this plugin's
    // own palettes is the active theme, so a marker hit disables it.
    if (classifyMarkerMode(samples) !== null) return null;
  }
  return classifyLuminanceMode(samples);
}

function clearDecorations(elements: Set<HTMLElement>): void {
  for (const element of elements) {
    element.removeAttribute(CHAT_SURFACE_ATTRIBUTE);
    element.removeAttribute(CHAT_CLEAR_ATTRIBUTE);
    element.removeAttribute(WORKSPACE_SIDEBAR_ATTRIBUTE);
    element.removeAttribute(RIGHT_SIDEBAR_ATTRIBUTE);
    element.removeAttribute(WORKSPACE_TABS_ATTRIBUTE);
    element.removeAttribute(SETTINGS_SURFACE_ATTRIBUTE);
    element.removeAttribute(SETTINGS_SIDEBAR_ATTRIBUTE);
  }
  elements.clear();
}

function depthToAncestor(
  descendant: HTMLElement,
  ancestor: HTMLElement,
  limit: number,
): number | null {
  let current: HTMLElement | null = descendant;
  let depth = 0;
  while (current && current !== ancestor && depth <= limit) {
    current = current.parentElement;
    depth += 1;
  }
  return current === ancestor && depth <= limit ? depth : null;
}

function markTransparentPath(
  descendant: HTMLElement,
  ancestor: HTMLElement,
  elements: Set<HTMLElement>,
): void {
  let current: HTMLElement | null = descendant;
  while (current && current !== ancestor) {
    current.setAttribute(CHAT_CLEAR_ATTRIBUTE, "");
    elements.add(current);
    current = current.parentElement;
  }
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

function decorateWorkspaceChrome(elements: Set<HTMLElement>): void {
  const root = document.getElementById("root");
  if (!root) return;

  const workspaceSidebarAnchor = root.querySelector<HTMLElement>(WORKSPACE_SIDEBAR_ANCHORS);
  const workspaceSidebar = workspaceSidebarAnchor
    ? findWorkspaceSidebarSurface(workspaceSidebarAnchor)
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
}

function findWorkspaceContentSurface(
  composer: HTMLElement,
  workspacePane: HTMLElement,
): HTMLElement {
  const paneRect = workspacePane.getBoundingClientRect();
  if (paneRect.width <= 0 || paneRect.height <= 0) return workspacePane;

  // The active conversation paints its FileDropZone-sized content shell, not
  // the outer workspace pane (which also includes the tab bar). Find the first
  // similarly full-sized ancestor whose other branch owns the empty content.
  const minimumWidth = paneRect.width * 0.7;
  const minimumHeight = Math.max(
    paneRect.height * 0.7,
    paneRect.height - 96,
  );
  let branch: HTMLElement = composer;
  let current = composer.parentElement;

  while (current && current !== workspacePane) {
    const rect = current.getBoundingClientRect();
    const hasContentBranch = [...current.children].some((child) => {
      if (!(child instanceof HTMLElement) || child === branch) return false;
      const childRect = child.getBoundingClientRect();
      return (
        childRect.width >= rect.width * 0.45 &&
        childRect.height >= Math.max(32, rect.height * 0.2)
      );
    });

    if (
      rect.width >= minimumWidth &&
      rect.height >= minimumHeight &&
      hasContentBranch
    ) {
      return current;
    }

    branch = current;
    current = current.parentElement;
  }

  return workspacePane;
}

function decorateChatSurfaces(elements: Set<HTMLElement>): void {
  const root = document.getElementById("root");
  if (!root) return;

  // Resolve every composer once, together with its ancestor chain, so the
  // per-chat shell walk below never re-scans subtrees. A read-only subagent
  // stream has no composer at all and previously cost a near-full-app
  // querySelectorAll per ancestor level.
  const composers = [
    ...root.querySelectorAll<HTMLElement>('[data-testid="message-input-root"]'),
  ];
  const composerAncestors = new Map<HTMLElement, Set<HTMLElement>>();
  for (const composer of composers) {
    const ancestors = new Set<HTMLElement>();
    let current: HTMLElement | null = composer;
    while (current && current !== root) {
      ancestors.add(current);
      current = current.parentElement;
    }
    composerAncestors.set(composer, ancestors);
  }

  for (const chat of root.querySelectorAll<HTMLElement>(
    '[data-testid="agent-chat-scroll"]',
  )) {
    let shell = chat.parentElement;
    let chatDepth = 1;

    // The composer sits a handful of levels above its chat stream; the cap of
    // eight adds a safety margin without pairing a read-only subagent stream
    // with an unrelated pane's composer.
    while (shell && shell !== root && chatDepth <= 8) {
      // Capture the narrowed shell; a `let` binding cannot stay narrowed
      // inside the find() callback below.
      const host = shell;
      const composer = composers.find((candidate) => {
        const ancestors = composerAncestors.get(candidate);
        return (
          ancestors !== undefined &&
          ancestors.has(host) &&
          depthToAncestor(candidate, host, 8) !== null
        );
      });
      if (composer) {
        shell.setAttribute(CHAT_SURFACE_ATTRIBUTE, "");
        elements.add(shell);
        markTransparentPath(chat, shell, elements);
        markTransparentPath(composer, shell, elements);
        break;
      }
      shell = shell.parentElement;
      chatDepth += 1;
    }
  }

  /* A newly opened Agent is a workspace draft until its first message is
   * submitted, so it has a composer but no agent-chat-scroll yet. Paint its
   * pane-sized content shell and clear only the composer's ancestor path.
   * Restricting the fallback to workspace panes avoids changing the New
   * Workspace screen and composers hosted in dialogs. */
  for (const composer of composers) {
    if (composer.closest(`[${CHAT_SURFACE_ATTRIBUTE}]`)) continue;

    const workspacePane = composer.closest<HTMLElement>(
      '[data-testid^="workspace-pane-"]',
    );
    if (!workspacePane) continue;

    const surface = findWorkspaceContentSurface(composer, workspacePane);
    surface.setAttribute(CHAT_SURFACE_ATTRIBUTE, "");
    elements.add(surface);
    markTransparentPath(composer, surface, elements);
  }
}

/**
 * Glass the settings screen while one of this plugin's settings screens is
 * open: the desktop detail pane (header + content) paints the wallpaper like
 * the chat's base surface, and the settings sidebar gets the same treatment
 * as the workspace sidebar. Anchors on Paseo's stable settings test-ids plus
 * the root testID our own screen renders; no-ops elsewhere, so other
 * settings pages keep their native look.
 */
function decorateSettingsSurfaces(elements: Set<HTMLElement>): void {
  const root = document.getElementById("root");
  if (!root) return;

  const hooks = [
    ...root.querySelectorAll<HTMLElement>('[data-testid="advance-settings-root"]'),
  ];
  if (hooks.length === 0) return;

  for (const hook of hooks) {
    const pane = hook.closest<HTMLElement>('[data-testid="settings-detail-pane"]');
    if (!pane) continue;

    // The content wrappers (ScrollView, centered column) between the plugin
    // sections and the pane would otherwise sit opaque on the image.
    markTransparentPath(hook, pane, elements);
    pane.setAttribute(SETTINGS_SURFACE_ATTRIBUTE, "");
    elements.add(pane);

    // Same for the screen header row above the scroll view.
    const headerTitle = pane.querySelector<HTMLElement>(
      '[data-testid="settings-detail-header-title"]',
    );
    if (headerTitle) markTransparentPath(headerTitle, pane, elements);
  }

  for (const sidebar of root.querySelectorAll<HTMLElement>(
    '[data-testid="settings-sidebar"]',
  )) {
    sidebar.setAttribute(SETTINGS_SIDEBAR_ATTRIBUTE, "");
    elements.add(sidebar);
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
