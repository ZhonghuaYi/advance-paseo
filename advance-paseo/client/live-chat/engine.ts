// DOM controller for the live-chat overlays (web/Electron only).
//
// Paseo's plugin UI slots (panels, pills, timeline rows) cannot float over
// the conversation, so — like the wallpaper engine — this module injects
// plain DOM: one overlay per visible chat viewport carries a TODO card
// (top-right, with the current plan/goal) and a tokens/sec meter (bottom
// right, above the composer). While the card is visible the chat column is
// shifted left through a padding rule keyed off an attribute on the chat
// scroll, so messages never render under the card; the shift disappears the
// moment the card does.
//
// Pane → agent mapping uses the host's stable tab test ids: the active tab
// of a workspace pane is `[data-testid^="workspace-tab-agent_"][aria-selected="true"]`.
// A pane with a single agent tab binds without the aria signal, and a pane
// keeps its last binding when no tab matches (focus mode hides the row) —
// the binding re-resolves on every tab switch through the mutation observer.
//
// The contribution layer pushes snapshots/meter readings via
// pushTaskSnapshot/pushRateMeter, and the engine re-renders only bindings
// whose inputs actually changed.

import { LIVE_CHAT_SETTINGS_DEFAULTS, type LiveChatSettings } from "../../shared/live-chat";
import type { RateMeterView, TaskSnapshot } from "./model";
import { parseRgba } from "../wallpaper/palettes";
import { ROOT_ATTRIBUTE } from "../wallpaper/wallpaper-css";
import type { WallpaperMode } from "../wallpaper/theme-detect";

const STYLE_ID = "paseo-advance-live-style";
const OVERLAY_ATTRIBUTE = "data-advance-live-overlay";
const CHAT_SHIFT_ATTRIBUTE = "data-advance-chat-shift";
const CHAT_SCROLL_SELECTOR = '[data-testid="agent-chat-scroll"]';
const PANE_SELECTOR = '[data-testid^="workspace-pane-"]';
const AGENT_TAB_PREFIX = "workspace-tab-agent_";
/** How far up from the chat scroll an overlay mount may sit. */
const HOST_WALK_LIMIT = 4;
/** Ancestors inspected while deciding whether the chat sits on light or dark paint. */
const MODE_WALK_LIMIT = 12;
const MODE_ALPHA_FLOOR = 0.45;

/** Reconcile debounce for structural mutation batches. */
const RECONCILE_DEBOUNCE_MS = 120;
/** Render-only passes (theme/mode flips) can wait a little longer. */
const RENDER_DEBOUNCE_MS = 200;
/** Refresh running meters so the sliding-window rate decays visibly. */
const METER_TICK_MS = 1000;

export interface LiveChatEngineState {
  readonly todoCardEnabled: boolean;
  readonly showGoal: boolean;
  readonly maxTodoItems: number;
  readonly chatShift: number;
  readonly rateMeterEnabled: boolean;
}

export const DEFAULT_ENGINE_STATE: LiveChatEngineState = {
  todoCardEnabled: LIVE_CHAT_SETTINGS_DEFAULTS.todoCardEnabled,
  showGoal: LIVE_CHAT_SETTINGS_DEFAULTS.showGoal,
  maxTodoItems: LIVE_CHAT_SETTINGS_DEFAULTS.maxTodoItems,
  chatShift: LIVE_CHAT_SETTINGS_DEFAULTS.chatShift,
  rateMeterEnabled: LIVE_CHAT_SETTINGS_DEFAULTS.rateMeterEnabled,
};

export function engineStateOf(settings: LiveChatSettings): LiveChatEngineState {
  return {
    todoCardEnabled: settings.todoCardEnabled,
    showGoal: settings.showGoal,
    maxTodoItems: settings.maxTodoItems,
    chatShift: settings.chatShift,
    rateMeterEnabled: settings.rateMeterEnabled,
  };
}

/** Contract the data layer implements: feed one agent's stream while bound. */
export interface LiveDataAdapter {
  /** Begin (or continue) serving data for an agent; return the stop function. */
  subscribeAgent(agentId: string): () => void;
}

interface PaneBinding {
  readonly chat: HTMLElement;
  readonly overlay: HTMLElement;
  readonly card: HTMLElement;
  readonly meter: HTMLElement;
  agentId: string | null;
  collapsed: boolean;
  /** Inputs of the last render; a mismatch forces a re-render. */
  rendered: {
    agentId: string | null;
    dataVersion: number;
    stateVersion: number;
    mode: WallpaperMode | null;
    collapsed: boolean;
  } | null;
}

interface Controller {
  state: LiveChatEngineState;
  adapter: LiveDataAdapter | null;
  bindings: Map<HTMLElement, PaneBinding>;
  /** agentId → data subscription stopper. */
  dataSubs: Map<string, () => void>;
  snapshots: Map<string, TaskSnapshot>;
  meters: Map<string, RateMeterView>;
  dataVersion: number;
  stateVersion: number;
  style: HTMLElement;
  rootObserver: MutationObserver;
  themeObserver: MutationObserver;
  rootObserved: boolean;
  reconcileTimer: number | null;
  renderTimer: number | null;
  meterTimer: number | null;
  startupTimer: number | null;
  stopped: boolean;
}

let controller: Controller | null = null;

/**
 * The injected stylesheet. Colors come from CSS custom properties set per
 * element (they follow the detected light/dark mode), so one sheet styles
 * every card. The chat-shift rule's pixel value is baked in and the sheet is
 * rebuilt whenever the setting changes.
 */
function buildStyleSheet(state: LiveChatEngineState): string {
  const shift =
    state.chatShift > 0
      ? `\n${CHAT_SCROLL_SELECTOR}[${CHAT_SHIFT_ATTRIBUTE}] > div:first-child {\n  padding-right: ${state.chatShift}px !important;\n  transition: padding-right 180ms ease !important;\n}\n`
      : "";
  return `[${OVERLAY_ATTRIBUTE}] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
[data-advance-todo-card] {
  position: absolute;
  top: 10px;
  right: 14px;
  width: min(340px, calc(100% - 28px));
  max-height: 55%;
  overflow-y: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  cursor: default;
  border-radius: 10px;
  border: 1px solid var(--adv-border);
  background: var(--adv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--adv-fg);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
}
[data-advance-todo-card] > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
[data-advance-todo-card] > header .adv-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--adv-muted);
}
[data-advance-todo-card] > header .adv-progress {
  font-size: 11px;
  color: var(--adv-muted);
}
[data-advance-todo-card] > header .adv-caret {
  margin-left: auto;
  font-size: 10px;
  color: var(--adv-muted);
}
[data-advance-todo-card] .adv-goal {
  margin: 0 10px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--adv-raised);
  border-left: 2px solid var(--adv-accent);
}
[data-advance-todo-card] .adv-goal-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--adv-muted);
  margin-bottom: 3px;
}
[data-advance-todo-card] .adv-goal-text {
  font-size: 12px;
  line-height: 1.45;
  color: var(--adv-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 88px;
  overflow-y: auto;
}
[data-advance-todo-card] .adv-todos {
  list-style: none;
  margin: 0;
  padding: 0 6px 8px 6px;
}
[data-advance-todo-card] .adv-todo {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.45;
}
[data-advance-todo-card] .adv-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  border: 1.5px solid var(--adv-muted);
  box-sizing: border-box;
}
[data-advance-todo-card] .adv-todo[data-status="in_progress"] .adv-dot {
  background: var(--adv-accent);
  border-color: var(--adv-accent);
}
[data-advance-todo-card] .adv-todo[data-status="in_progress"] .adv-text {
  color: var(--adv-fg);
  font-weight: 500;
}
[data-advance-todo-card] .adv-todo[data-status="completed"] .adv-dot {
  background: var(--adv-muted);
  border-color: var(--adv-muted);
}
[data-advance-todo-card] .adv-todo[data-status="completed"] .adv-text {
  color: var(--adv-muted);
  text-decoration: line-through;
}
[data-advance-todo-card] .adv-text {
  color: var(--adv-fg);
  overflow-wrap: anywhere;
}
[data-advance-todo-card] .adv-more {
  padding: 3px 6px 0;
  font-size: 11px;
  color: var(--adv-muted);
}
[data-advance-rate-meter] {
  position: absolute;
  bottom: 6px;
  right: 14px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--adv-border);
  background: var(--adv-pill-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--adv-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-advance-rate-meter] .adv-rate {
  color: var(--adv-fg);
  font-weight: 600;
}${shift}`;
}

const MODE_VARS: Record<WallpaperMode, string> = {
  light:
    "--adv-fg:#1f2328;--adv-muted:#57606a;--adv-border:rgba(24,28,32,0.14);" +
    "--adv-card-bg:rgba(255,255,255,0.78);--adv-pill-bg:rgba(255,255,255,0.66);" +
    "--adv-raised:rgba(15,19,24,0.05);--adv-accent:#0f66d4;",
  dark:
    "--adv-fg:#e6edf3;--adv-muted:#95a0ad;--adv-border:rgba(230,237,243,0.16);" +
    "--adv-card-bg:rgba(20,25,32,0.8);--adv-pill-bg:rgba(20,25,32,0.7);" +
    "--adv-raised:rgba(230,237,243,0.07);--adv-accent:#6cb0ff;",
};

/** Install the controller; no-op on native hosts. */
export function installLiveChatEngine(): void {
  if (typeof document === "undefined") return;
  removeLiveChatEngine();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildStyleSheet(DEFAULT_ENGINE_STATE);
  document.head.append(style);

  const instance: Controller = {
    state: DEFAULT_ENGINE_STATE,
    adapter: null,
    bindings: new Map(),
    dataSubs: new Map(),
    snapshots: new Map(),
    meters: new Map(),
    dataVersion: 1,
    stateVersion: 1,
    style,
    rootObserver: null as unknown as MutationObserver,
    themeObserver: null as unknown as MutationObserver,
    rootObserved: false,
    reconcileTimer: null,
    renderTimer: null,
    meterTimer: null,
    startupTimer: null,
    stopped: false,
  };
  controller = instance;

  instance.rootObserver = new MutationObserver((records) => {
    if (instance.stopped) return;
    // Streaming re-renders only shuffle text nodes; they can never mount a
    // chat, unmount one, or flip a tab selection.
    if (isTextOnlyBatch(records)) return;
    if (
      !records.some(
        (record) => record.type === "childList" || record.attributeName === "aria-selected",
      )
    ) {
      return;
    }
    scheduleReconcile(instance);
  });

  // Theme flips swap head styles or the wallpaper root attribute; neither
  // changes pane structure, so they only need a render pass to re-detect the
  // light/dark palette.
  instance.themeObserver = new MutationObserver(() => {
    if (instance.stopped) return;
    scheduleRender(instance);
  });
  instance.themeObserver.observe(document.head, { childList: true, subtree: true });
  instance.themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-paseo-advance-wallpaper"],
  });

  instance.meterTimer = window.setInterval(() => {
    if (instance.stopped) return;
    for (const binding of instance.bindings.values()) renderBinding(instance, binding);
  }, METER_TICK_MS);

  scheduleReconcile(instance);
  // Chats mount after plugins load; catch late mounts like the wallpaper
  // engine does.
  instance.startupTimer = window.setTimeout(() => {
    instance.startupTimer = null;
    scheduleReconcile(instance);
  }, 600);
}

/** Remove the controller and every injected element/subscription. */
export function removeLiveChatEngine(): void {
  if (typeof document === "undefined") return;
  const instance = controller;
  if (instance === null) return;
  instance.stopped = true;
  if (instance.reconcileTimer !== null) window.clearTimeout(instance.reconcileTimer);
  if (instance.renderTimer !== null) window.clearTimeout(instance.renderTimer);
  if (instance.meterTimer !== null) window.clearInterval(instance.meterTimer);
  if (instance.startupTimer !== null) window.clearTimeout(instance.startupTimer);
  instance.rootObserver.disconnect();
  instance.themeObserver.disconnect();
  for (const binding of instance.bindings.values()) destroyBinding(binding);
  instance.bindings.clear();
  for (const stop of instance.dataSubs.values()) stop();
  instance.dataSubs.clear();
  instance.style.remove();
  controller = null;
}

/** Point the engine at its data layer; bindings subscribe on the next pass. */
export function setLiveDataAdapter(adapter: LiveDataAdapter): void {
  if (typeof document === "undefined") return;
  const instance = controller;
  if (instance === null || instance.stopped) return;
  instance.adapter = adapter;
  scheduleReconcile(instance);
}

/** Apply new settings; rebuilds the sheet (chat-shift px) and re-renders. */
export function applyLiveChatState(state: LiveChatEngineState): void {
  if (typeof document === "undefined") return;
  const instance = controller;
  if (instance === null || instance.stopped) return;
  instance.state = state;
  instance.stateVersion += 1;
  instance.style.textContent = buildStyleSheet(state);
  for (const binding of instance.bindings.values()) renderBinding(instance, binding);
}

/** Latest task snapshot for an agent, pushed by the data layer. */
export function pushTaskSnapshot(agentId: string, snapshot: TaskSnapshot | null): void {
  const instance = controller;
  if (instance === null || instance.stopped) return;
  if (snapshot === null || snapshot.todos.length === 0) {
    instance.snapshots.delete(agentId);
  } else {
    instance.snapshots.set(agentId, snapshot);
  }
  instance.dataVersion += 1;
  for (const binding of instance.bindings.values()) {
    if (binding.agentId === agentId) renderBinding(instance, binding);
  }
}

/** Latest meter reading for an agent, pushed by the data layer. */
export function pushRateMeter(agentId: string, view: RateMeterView | null): void {
  const instance = controller;
  if (instance === null || instance.stopped) return;
  if (view === null) {
    instance.meters.delete(agentId);
  } else {
    instance.meters.set(agentId, view);
  }
  instance.dataVersion += 1;
  for (const binding of instance.bindings.values()) {
    if (binding.agentId === agentId) renderBinding(instance, binding);
  }
}

/** #root may mount after the plugin loads; keep trying until it appears. */
function observeRoot(instance: Controller): void {
  if (instance.rootObserved) return;
  const root = document.getElementById("root");
  if (root === null) return;
  instance.rootObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected"],
  });
  instance.rootObserved = true;
}

function scheduleReconcile(instance: Controller): void {
  if (instance.stopped) return;
  if (instance.reconcileTimer !== null) window.clearTimeout(instance.reconcileTimer);
  instance.reconcileTimer = window.setTimeout(() => {
    instance.reconcileTimer = null;
    reconcile(instance);
  }, RECONCILE_DEBOUNCE_MS);
}

function scheduleRender(instance: Controller): void {
  if (instance.stopped) return;
  if (instance.renderTimer !== null) return;
  instance.renderTimer = window.setTimeout(() => {
    instance.renderTimer = null;
    for (const binding of instance.bindings.values()) renderBinding(instance, binding);
  }, RENDER_DEBOUNCE_MS);
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

/**
 * Resolve every visible chat viewport to its pane's active agent and bring
 * bindings in sync: create overlays for new chats, drop detached ones, and
 * re-target the data subscriptions when the active tab changes.
 */
function reconcile(instance: Controller): void {
  if (instance.stopped) return;
  observeRoot(instance);

  const root = document.getElementById("root");
  const chats =
    (root === null
      ? document.querySelectorAll(CHAT_SCROLL_SELECTOR)
      : root.querySelectorAll(CHAT_SCROLL_SELECTOR)) as HTMLElement[];
  const seen = new Set<HTMLElement>();

  for (const chat of chats) {
    seen.add(chat);
    let binding = instance.bindings.get(chat);
    if (binding === undefined) {
      binding = createBinding(chat);
      instance.bindings.set(chat, binding);
    }
    const agentId = resolveActiveAgent(binding);
    if (agentId !== binding.agentId) {
      binding.agentId = agentId;
      binding.rendered = null;
    }
  }

  for (const [chat, binding] of instance.bindings) {
    if (seen.has(chat)) continue;
    destroyBinding(binding);
    instance.bindings.delete(chat);
  }

  // Keep exactly one data subscription per bound agent.
  const wanted = new Set<string>();
  for (const binding of instance.bindings.values()) {
    if (binding.agentId !== null) wanted.add(binding.agentId);
  }
  for (const agentId of [...instance.dataSubs.keys()]) {
    if (wanted.has(agentId)) continue;
    instance.dataSubs.get(agentId)?.();
    instance.dataSubs.delete(agentId);
  }
  if (instance.adapter !== null) {
    for (const agentId of wanted) {
      if (instance.dataSubs.has(agentId)) continue;
      instance.dataSubs.set(agentId, instance.adapter.subscribeAgent(agentId));
    }
  }

  for (const binding of instance.bindings.values()) renderBinding(instance, binding);
}

/** Create the overlay + card + meter shell for one chat viewport. */
function createBinding(chat: HTMLElement): PaneBinding {
  // The chat viewport wraps agent-chat-scroll with position:relative in the
  // host; walk up a little in case an intermediate wrapper intervenes.
  let host: HTMLElement | null = chat.parentElement;
  let walked = 0;
  while (host !== null && walked < HOST_WALK_LIMIT) {
    const position = window.getComputedStyle(host).position;
    if (position === "relative" || position === "absolute" || position === "fixed") break;
    host = host.parentElement;
    walked += 1;
  }
  if (host === null) host = chat.parentElement ?? chat;

  const overlay = document.createElement("div");
  overlay.setAttribute(OVERLAY_ATTRIBUTE, "");
  const card = document.createElement("aside");
  card.setAttribute("data-advance-todo-card", "");
  card.setAttribute("data-testid", "advance-todo-card");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("style", `display:none;${MODE_VARS.dark}`);
  const meter = document.createElement("div");
  meter.setAttribute("data-advance-rate-meter", "");
  meter.setAttribute("data-testid", "advance-rate-meter");
  meter.setAttribute("style", `display:none;${MODE_VARS.dark}`);
  overlay.append(card);
  overlay.append(meter);
  host.append(overlay);

  const binding: PaneBinding = {
    chat,
    overlay,
    card,
    meter,
    agentId: null,
    collapsed: false,
    rendered: null,
  };
  card.addEventListener("click", () => {
    binding.collapsed = !binding.collapsed;
    const current = controller;
    if (current !== null) renderBinding(current, binding);
  });
  return binding;
}

function destroyBinding(binding: PaneBinding): void {
  binding.chat.removeAttribute(CHAT_SHIFT_ATTRIBUTE);
  binding.overlay.remove();
}

/**
 * Which agent does this pane currently show? The active tab's test id when
 * the host exposes the selection, the only agent tab as a fallback, and the
 * previous binding when neither is readable (focus mode hides the tab row).
 */
function resolveActiveAgent(binding: PaneBinding): string | null {
  const pane = binding.chat.closest(PANE_SELECTOR);
  if (pane === null) return binding.agentId;

  const tabs = [
    ...(pane.querySelectorAll(`[data-testid^="${AGENT_TAB_PREFIX}"]`) as HTMLElement[]),
  ];
  if (tabs.length === 0) return binding.agentId;

  const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  const target = selected ?? (tabs.length === 1 ? tabs[0] : null);
  if (target === null) return binding.agentId;

  const id = target.getAttribute("data-testid")?.slice(AGENT_TAB_PREFIX.length) ?? "";
  return id.length > 0 ? id : binding.agentId;
}

/**
 * Light or dark paint under this chat. While the wallpaper paints, its
 * applied mode on <html> is authoritative (theme surfaces are transparent
 * beneath it); otherwise the nearest ancestor with an opaque-enough
 * background decides. Defaults to dark.
 */
function detectMode(chat: HTMLElement): WallpaperMode {
  const wallpaperMode = document.documentElement.getAttribute(ROOT_ATTRIBUTE);
  if (wallpaperMode === "light" || wallpaperMode === "dark") return wallpaperMode;
  let element: HTMLElement | null = chat;
  let walked = 0;
  while (element !== null && walked < MODE_WALK_LIMIT) {
    const color = parseRgba(window.getComputedStyle(element).backgroundColor);
    if (color !== null && color[3] >= MODE_ALPHA_FLOOR) {
      return wcagRelativeLuminance(color) >= 0.5 ? "light" : "dark";
    }
    element = element.parentElement;
    walked += 1;
  }
  return "dark";
}

/** WCAG relative luminance of an sRGB color, alpha ignored. */
function wcagRelativeLuminance(color: readonly [number, number, number, number]): number {
  const channel = (raw: number): number => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
  );
}

/** Re-render one binding if any of its inputs changed. */
function renderBinding(instance: Controller, binding: PaneBinding): void {
  if (instance.stopped) return;
  const snapshot =
    binding.agentId === null ? undefined : instance.snapshots.get(binding.agentId);
  const meterView =
    binding.agentId === null ? undefined : instance.meters.get(binding.agentId);
  const cardVisible = instance.state.todoCardEnabled && snapshot !== undefined;
  const meterVisible = instance.state.rateMeterEnabled && meterView !== undefined;
  const mode = cardVisible || meterVisible ? detectMode(binding.chat) : null;

  if (
    binding.rendered !== null &&
    binding.rendered.agentId === binding.agentId &&
    binding.rendered.dataVersion === instance.dataVersion &&
    binding.rendered.stateVersion === instance.stateVersion &&
    binding.rendered.collapsed === binding.collapsed &&
    binding.rendered.mode === mode
  ) {
    // Inputs unchanged; the meter tick still refreshes its own text.
    if (meterVisible) renderMeterText(binding.meter, meterView as RateMeterView);
    return;
  }
  binding.rendered = {
    agentId: binding.agentId,
    dataVersion: instance.dataVersion,
    stateVersion: instance.stateVersion,
    collapsed: binding.collapsed,
    mode,
  };

  const vars = mode === null ? MODE_VARS.dark : MODE_VARS[mode];

  if (cardVisible && snapshot !== undefined) {
    binding.card.setAttribute("style", vars);
    renderCard(instance, binding, snapshot);
    if (instance.state.chatShift > 0) {
      binding.chat.setAttribute(CHAT_SHIFT_ATTRIBUTE, "");
    } else {
      binding.chat.removeAttribute(CHAT_SHIFT_ATTRIBUTE);
    }
  } else {
    binding.card.setAttribute("style", `display:none;${vars}`);
    binding.chat.removeAttribute(CHAT_SHIFT_ATTRIBUTE);
  }

  if (meterVisible && meterView !== undefined) {
    binding.meter.setAttribute("style", vars);
    renderMeterText(binding.meter, meterView);
  } else {
    binding.meter.setAttribute("style", `display:none;${vars}`);
  }
}

function appendTextChild(parent: HTMLElement, className: string, text: string): HTMLElement {
  const child = document.createElement("span");
  child.setAttribute("class", className);
  child.textContent = text;
  parent.append(child);
  return child;
}

function renderCard(instance: Controller, binding: PaneBinding, snapshot: TaskSnapshot): void {
  const card = binding.card;
  // Rebuild content: rows are few and renders are rare.
  while (card.children.length > 0) card.children[0].remove();

  const header = document.createElement("header");
  const done = snapshot.todos.filter((row) => row.status === "completed").length;
  appendTextChild(header, "adv-title", "TODO");
  appendTextChild(header, "adv-progress", `${done}/${snapshot.todos.length}`);
  appendTextChild(header, "adv-caret", binding.collapsed ? "▸" : "▾");
  card.append(header);
  if (binding.collapsed) {
    card.setAttribute("data-collapsed", "true");
    return;
  }
  card.removeAttribute("data-collapsed");

  if (instance.state.showGoal && snapshot.goal !== null) {
    const goal = document.createElement("div");
    goal.setAttribute("class", "adv-goal");
    const label = document.createElement("div");
    label.setAttribute("class", "adv-goal-label");
    label.textContent = "GOAL";
    goal.append(label);
    const text = document.createElement("div");
    text.setAttribute("class", "adv-goal-text");
    text.textContent = snapshot.goal;
    goal.append(text);
    card.append(goal);
  }

  const list = document.createElement("ul");
  list.setAttribute("class", "adv-todos");
  const limit = Math.min(instance.state.maxTodoItems, snapshot.todos.length);
  for (let index = 0; index < limit; index += 1) {
    const row = snapshot.todos[index];
    const item = document.createElement("li");
    item.setAttribute("class", "adv-todo");
    item.setAttribute("data-status", row.status);
    const dot = document.createElement("span");
    dot.setAttribute("class", "adv-dot");
    item.append(dot);
    appendTextChild(item, "adv-text", row.text);
    list.append(item);
  }
  card.append(list);

  const hidden = snapshot.todos.length - limit;
  if (hidden > 0) {
    const more = document.createElement("div");
    more.setAttribute("class", "adv-more");
    more.textContent = `+${hidden}`;
    card.append(more);
  }
}

function renderMeterText(meter: HTMLElement, view: RateMeterView): void {
  const rate =
    view.ratePerSecond === null ? "—" : `${formatRate(view.ratePerSecond)}`;
  const output = view.outputTokens !== null && view.outputTokens > 0 ? formatCount(view.outputTokens) : "";
  const context =
    view.contextRatio !== null ? `${Math.round(view.contextRatio * 100)}` : "";
  // Skip identical rewrites: the meter tick fires every second and every DOM
  // write would echo through the mutation observer into another reconcile.
  const raw = `${rate}|${output}|${context}`;
  if (meter.getAttribute("data-raw") === raw) return;
  meter.setAttribute("data-raw", raw);

  while (meter.children.length > 0) meter.children[0].remove();
  appendTextChild(meter, "adv-rate", `${rate} tok/s`);
  if (output.length > 0) appendTextChild(meter, "adv-out", output);
  if (context.length > 0) appendTextChild(meter, "adv-ctx", `ctx ${context}%`);
}

function formatRate(rate: number): string {
  if (rate >= 100) return String(Math.round(rate));
  return rate.toFixed(1);
}

function formatCount(value: number): string {
  if (value >= 100_000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}
