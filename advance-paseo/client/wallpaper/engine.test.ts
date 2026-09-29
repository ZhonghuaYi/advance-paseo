// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WALLPAPER_SETTINGS_DEFAULTS } from "../../shared/wallpaper";
import { PALETTE_PAIRS } from "./palettes";
import { ROOT_ATTRIBUTE } from "./wallpaper-css";
vi.mock("../web", () => ({ getLocalWallpaperHostId: vi.fn(async () => "local") }));
type Engine = typeof import("./engine");
const engines: Engine[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.textContent = "";
  const root = document.createElement("div"); root.id = "root"; document.body.append(root);
  document.documentElement.style.setProperty("--colors-surface0", "#fff");
  Reflect.set(window, "matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  for (const e of engines) e.removeWallpaperEngine();
  engines.length = 0;
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--colors-surface0");
});
async function host() {
  vi.resetModules(); const e = await import("./engine");
  e.verifyWallpaperHost("local", "local");
  e.installWallpaperEngine(PALETTE_PAIRS[0].light); engines.push(e); return e;
}
const image = (name: string) => ({ light: `data:image/png;base64,${name}`, dark: null });

it("rejects an older request after a newer image request completes", async () => {
  const e = await host();
  const old = e.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)!;
  const fresh = e.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)!;
  expect(fresh.apply(image("Yg=="))).toBe(true);
  expect(old.apply(image("YQ=="))).toBe(false);
  e.applyWallpaperState({ ...e.DEFAULT_ENGINE_STATE, blur: 3 });
  expect(fresh.isCurrent()).toBe(true); // style edits do not cancel image loads
  fresh.cancel(); expect(fresh.apply(image("Yw=="))).toBe(false);
});

it("prevents an old host, bootstrap or disposed controller from overwriting settings", async () => {
  const a = await host(), b = await host();
  const old = a.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS, "bootstrap")!;
  const selected = b.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)!;
  expect(old.apply(image("YQ=="))).toBe(false);
  expect(a.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS, "bootstrap")).toBeNull();
  expect(selected.apply(image("Yg=="))).toBe(true);
  b.removeWallpaperEngine();
  expect(selected.apply(image("YQ=="))).toBe(false);
  a.removeWallpaperEngine();
  const c = await host();
  expect(old.apply(image("YQ=="))).toBe(false);
  const startup = c.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS, "bootstrap")!;
  c.applyWallpaperState(c.DEFAULT_ENGINE_STATE);
  expect(startup.apply(image("YQ=="))).toBe(false);
});

it("clears bootstrap retries when the contribution is disposed", async () => {
  vi.resetModules();
  const { contributeWallpaper } = await import("./contribute");
  const rpc = vi.fn(async () => { throw new Error("offline"); });
  const cleanup = contributeWallpaper({ addTheme: vi.fn(), rpc } as unknown as import("@getpaseo/plugin/client").PluginClientContext);
  await vi.advanceTimersByTimeAsync(0);
  expect(rpc).toHaveBeenCalledOnce();
  cleanup();
  await vi.advanceTimersByTimeAsync(10000);
  expect(rpc).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects remote installation, settings writes and image requests even before local connects", async () => {
  vi.resetModules();
  const remote = await import("./engine"); engines.push(remote);
  expect(remote.verifyWallpaperHost("remote", "local")).toBe(false);
  remote.installWallpaperEngine(PALETTE_PAIRS[0].light);
  expect(document.querySelectorAll("style")).toHaveLength(0);
  const local = await host();
  const request = local.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)!;
  expect(remote.applyWallpaperState({ ...local.DEFAULT_ENGINE_STATE, enabled: false })).toBe("rejected");
  expect(remote.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)).toBeNull();
  remote.removeWallpaperEngine();
  expect(request.apply(image("YQ=="))).toBe(true);
  local.removeWallpaperEngine();
  expect(remote.applyWallpaperState(remote.DEFAULT_ENGINE_STATE)).toBe("rejected");
  expect(document.querySelectorAll("style")).toHaveLength(0);
});

it("revoking identity cancels pending image writes and never accepts an unknown identity", async () => {
  const local = await host();
  const request = local.beginWallpaperImages(WALLPAPER_SETTINGS_DEFAULTS)!;
  expect(local.verifyWallpaperHost(null, null)).toBe(false);
  expect(request.apply(image("YQ=="))).toBe(false);
  expect(local.verifyWallpaperHost("", "")).toBe(false);
  expect(local.applyWallpaperState(local.DEFAULT_ENGINE_STATE)).toBe("rejected");
});

it("remote bootstrap only reads identity, not wallpaper settings or image data", async () => {
  vi.resetModules();
  const { contributeWallpaper } = await import("./contribute");
  const rpc = vi.fn(async (_contract: unknown, _input: unknown) => ({ serverId: "remote" }));
  const cleanup = contributeWallpaper({ addTheme: vi.fn(), rpc } as unknown as import("@getpaseo/plugin/client").PluginClientContext);
  await vi.advanceTimersByTimeAsync(20000);
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc.mock.calls[0][0]).toMatchObject({ name: "advance.wallpaper.host" });
  expect(document.querySelectorAll("style")).toHaveLength(0);
  cleanup();
});

it("automatically loads only the matching local host after a remote host connects first", async () => {
  vi.resetModules();
  const remote = await import("./contribute");
  const remoteRpc = vi.fn(async () => ({ serverId: "remote" }));
  const closeRemote = remote.contributeWallpaper({ addTheme: vi.fn(), rpc: remoteRpc } as any);
  await vi.advanceTimersByTimeAsync(0);
  vi.resetModules();
  const local = await import("./contribute");
  const localRpc = vi.fn(async (contract: { name: string }) => {
    if (contract.name === "advance.wallpaper.host") return { serverId: "local" };
    if (contract.name === "advance.wallpaper.read") return { dataUrl: "data:image/png;base64,YQ==" };
    return { status: "ready", values: { ...WALLPAPER_SETTINGS_DEFAULTS,
      light: { kind: "managed", id: "local-image" } } };
  });
  const closeLocal = local.contributeWallpaper({ addTheme: vi.fn(), rpc: localRpc } as any);
  await vi.advanceTimersByTimeAsync(1000);
  expect(remoteRpc).toHaveBeenCalledOnce();
  expect(localRpc.mock.calls.map(([contract]) => contract.name)).toContain("advance.wallpaper.read");
  expect(document.documentElement.getAttribute(ROOT_ATTRIBUTE)).toBe("light");
  closeRemote();
  expect(document.querySelectorAll("style")).toHaveLength(1);
  closeLocal();
  expect(document.querySelectorAll("style")).toHaveLength(0);
});

it("does not install after disposal while daemon identity is in flight", async () => {
  vi.resetModules();
  const { contributeWallpaper } = await import("./contribute");
  let finish!: (value: { serverId: string }) => void;
  const rpc = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const cleanup = contributeWallpaper({ addTheme: vi.fn(), rpc } as any);
  await vi.advanceTimersByTimeAsync(0);
  cleanup();
  finish({ serverId: "local" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(rpc).toHaveBeenCalledOnce();
  expect(document.querySelectorAll("style")).toHaveLength(0);
});
