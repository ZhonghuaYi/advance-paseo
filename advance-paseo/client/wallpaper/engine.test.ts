// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WALLPAPER_SETTINGS_DEFAULTS } from "../../shared/wallpaper";
import { PALETTE_PAIRS } from "./palettes";
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
  await Promise.resolve(); await Promise.resolve();
  expect(rpc).toHaveBeenCalledOnce();
  cleanup();
  await vi.advanceTimersByTimeAsync(10000);
  expect(rpc).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
