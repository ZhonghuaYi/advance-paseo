// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type Engine = typeof import("./engine");
const engines: Engine[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.textContent = "";
  const root = document.createElement("div"); root.id = "root"; document.body.append(root);
});
afterEach(() => {
  for (const engine of engines) engine.removeLiveChatEngine();
  engines.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.textContent = "";
});
async function host() {
  vi.resetModules();
  const engine = await import("./engine");
  engine.installLiveChatEngine(); engines.push(engine);
  const stop = vi.fn();
  const subscribe = vi.fn(() => stop);
  engine.setLiveDataAdapter({ subscribeAgent: subscribe });
  return { engine, subscribe, stop };
}
function pane(id: string) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-testid", `workspace-pane-${id}`);
  const tab = document.createElement("div");
  tab.setAttribute("data-testid", `workspace-tab-agent_${id}`);
  tab.setAttribute("aria-selected", "true"); wrapper.append(tab);
  const viewport = document.createElement("div"); viewport.style.setProperty("position", "relative");
  const chat = document.createElement("div"); chat.setAttribute("data-testid", "agent-chat-scroll");
  viewport.append(chat); wrapper.append(viewport); document.getElementById("root")!.append(wrapper);
  return { wrapper, chat, tab };
}
const snapshot = (text: string) => ({ todos: [{ text, status: "pending" as const }], goal: null });

describe("shared live chat controller", () => {
  it("isolates host subscriptions and settings, and survives one host leaving", async () => {
    const aPane = pane("agent-a"), bPane = pane("agent-b");
    const a = await host(), b = await host();
    a.engine.setLiveAgentDirectory(new Set(["agent-a"]));
    expect(a.subscribe).not.toHaveBeenCalled(); // B has not resolved its directory.
    b.engine.setLiveAgentDirectory(new Set(["agent-b"]));
    expect(a.subscribe.mock.calls).toEqual([["agent-a"]]);
    expect(b.subscribe.mock.calls).toEqual([["agent-b"]]);
    a.engine.applyLiveChatState({ ...a.engine.DEFAULT_ENGINE_STATE, chatShift: 120 });
    b.engine.applyLiveChatState({ ...b.engine.DEFAULT_ENGINE_STATE, chatShift: 280 });
    a.engine.pushTaskSnapshot("agent-a", snapshot("A only"));
    b.engine.pushTaskSnapshot("agent-b", snapshot("B only"));
    expect(document.querySelectorAll("#paseo-advance-live-style")).toHaveLength(1);
    expect(aPane.wrapper.querySelectorAll("[data-advance-live-overlay]")).toHaveLength(1);
    expect(bPane.wrapper.querySelectorAll("[data-advance-live-overlay]")).toHaveLength(1);
    expect(aPane.wrapper.textContent).toContain("A only");
    expect(aPane.wrapper.textContent).not.toContain("B only");
    expect(aPane.chat.style.getPropertyValue("--advance-chat-shift")).toBe("120px");
    expect(bPane.chat.style.getPropertyValue("--advance-chat-shift")).toBe("280px");
    a.engine.removeLiveChatEngine();
    expect(a.stop).toHaveBeenCalledOnce(); expect(b.stop).not.toHaveBeenCalled();
    expect(bPane.wrapper.textContent).toContain("B only");
    b.engine.removeLiveChatEngine();
    expect(b.stop).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("[data-advance-live-overlay]")).toHaveLength(0);
    expect(document.getElementById("paseo-advance-live-style")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("withholds ambiguous ownership and rebinds after conflict is resolved", async () => {
    pane("same"); const a = await host(), b = await host();
    a.engine.setLiveAgentDirectory(new Set(["same"]));
    b.engine.setLiveAgentDirectory(new Set(["same"]));
    expect(a.subscribe).not.toHaveBeenCalled(); expect(b.subscribe).not.toHaveBeenCalled();
    b.engine.setLiveAgentDirectory(new Set());
    expect(a.subscribe).toHaveBeenCalledWith("same");
  });
  it("observes real DOM mounts, tab switches and removals", async () => {
    const a = await host(); a.engine.setLiveAgentDirectory(new Set(["first", "second"]));
    await vi.advanceTimersByTimeAsync(700);
    const p = pane("first");
    await vi.advanceTimersByTimeAsync(400);
    expect(a.subscribe).toHaveBeenCalledWith("first");
    const tab = document.createElement("div");
    tab.setAttribute("data-testid", "workspace-tab-agent_second");
    tab.setAttribute("aria-selected", "true"); p.tab.setAttribute("aria-selected", "false"); p.wrapper.append(tab);
    await vi.advanceTimersByTimeAsync(400);
    expect(a.subscribe).toHaveBeenLastCalledWith("second");
    p.wrapper.remove(); await vi.advanceTimersByTimeAsync(400);
    expect(a.stop).toHaveBeenCalledTimes(2);
  });
  it("does nothing when the native host has no document", async () => {
    vi.stubGlobal("document", undefined);
    const a = await host(); a.engine.setLiveAgentDirectory(new Set(["x"]));
    expect(a.subscribe).not.toHaveBeenCalled();
    a.engine.removeLiveChatEngine();
    vi.unstubAllGlobals();
  });
});
