import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WALLPAPER_SETTINGS_DEFAULTS } from "../../shared/wallpaper";
import { en } from "../i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  settings: {} as any,
  rpcs: new Map<string, ReturnType<typeof vi.fn>>(),
  applyState: vi.fn(), appliedImages: vi.fn(),
}));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Image: "Image" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => mocks.settings,
  useRpc: (contract: { name: string }) => mocks.rpcs.get(contract.name),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsAction: "SettingsAction", SettingsCard: "SettingsCard", SettingsInput: "SettingsInput",
  SettingsRow: "SettingsRow", SettingsSection: "SettingsSection", SettingsSelect: "SettingsSelect", SettingsSwitch: "SettingsSwitch",
}));
vi.mock("../ui/slider-row", () => ({ SliderRow: "SliderRow" }));
vi.mock("../web", () => ({ isWebPlatform: () => true, pickWallpaperImage: vi.fn(async () => null) }));
vi.mock("../i18n/store", () => ({ useText: () => en }));
vi.mock("./engine", () => ({
  engineStateOf: (values: unknown) => values,
  applyWallpaperState: mocks.applyState,
  beginWallpaperImages: () => {
    let cancelled = false;
    return { cancel() { cancelled = true; }, apply(images: unknown) {
      if (cancelled) return false;
      mocks.appliedImages(images); return true;
    } };
  },
}));
import { WallpaperSettingsSection } from "./settings-ui";

let renderer: ReactTestRenderer;
const props = { theme: { colors: { foregroundMuted: "#777", statusDanger: "#f00", accent: "#00f" } },
  layout: { compact: false, platform: "web" }, host: { id: "one", label: "one" } } as PluginSurfaceProps;
const rpc = (name: string) => mocks.rpcs.get(`advance.wallpaper.${name}`)!;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.applyState.mockClear(); mocks.appliedImages.mockClear(); mocks.rpcs.clear();
  mocks.settings = { status: "ready", values: { ...WALLPAPER_SETTINGS_DEFAULTS, light: { kind: "managed", id: "a" } },
    revision: "1", saving: false, saveError: null, save: vi.fn(async () => false), reload: vi.fn(async () => {}), reset: vi.fn() };
  for (const name of ["list", "read", "read-path", "upload", "delete"]) mocks.rpcs.set(`advance.wallpaper.${name}`, vi.fn());
  rpc("list").mockResolvedValue({ items: [{ id: "a", name: "Photo", mime: "image/png", bytes: 1, addedAt: "2026-01-01" }] });
  rpc("read").mockResolvedValue({ dataUrl: "image-a" });
  rpc("delete").mockResolvedValue({ deleted: true });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => { renderer = create(createElement(WallpaperSettingsSection, props)); await flush(); });
}
function deleteButton() {
  return renderer.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Delete Photo")[0];
}

describe("wallpaper settings operations", () => {
  it("preserves the image and restores persisted preview when save fails", async () => {
    await mount();
    await act(async () => { deleteButton().props.onPress(); await flush(); });
    expect(mocks.settings.save).toHaveBeenCalledWith(expect.objectContaining({ light: null }), "1");
    expect(rpc("delete")).not.toHaveBeenCalled();
    expect(mocks.settings.reload).toHaveBeenCalledOnce();
    expect(mocks.applyState).toHaveBeenLastCalledWith(mocks.settings.values);
    expect(renderer.root.findAll(node => String(node.type) === "Text" &&
      node.props.children === en.common.saveFailed)).toHaveLength(1);
  });
  it("waits for a successful save before deletion and ignores duplicate presses", async () => {
    let finish!: (saved: boolean) => void;
    mocks.settings.save.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await mount(); const press = deleteButton().props.onPress;
    await act(async () => { press(); press(); });
    expect(mocks.settings.save).toHaveBeenCalledOnce();
    expect(deleteButton().props.disabled).toBe(true);
    expect(rpc("delete")).not.toHaveBeenCalled();
    await act(async () => { finish(true); await flush(); });
    expect(rpc("delete")).toHaveBeenCalledOnce();
  });
  it("does not apply image results from an earlier render or an unmounted screen", async () => {
    const pending = new Map<string, (result: { dataUrl: string }) => void>();
    rpc("read").mockImplementation(({ id }) => new Promise(resolve => pending.set(id, resolve)));
    await mount();
    mocks.settings = { ...mocks.settings, values: { ...mocks.settings.values, light: { kind: "managed", id: "b" } } };
    await act(async () => { renderer.update(createElement(WallpaperSettingsSection, props)); });
    await act(async () => { pending.get("b")!({ dataUrl: "new" }); await flush(); });
    await act(async () => { pending.get("a")!({ dataUrl: "old" }); await flush(); });
    expect(mocks.appliedImages.mock.calls).toEqual([[{ light: "new", dark: null }]]);
    mocks.settings = { ...mocks.settings, values: { ...mocks.settings.values, light: { kind: "managed", id: "c" } } };
    await act(async () => renderer.update(createElement(WallpaperSettingsSection, props)));
    await act(async () => renderer.unmount());
    pending.get("c")!({ dataUrl: "unmounted" }); await flush();
    expect(mocks.appliedImages).toHaveBeenCalledOnce();
  });
  it("does not re-read images when a style value changes", async () => {
    await mount();
    const calls = rpc("read").mock.calls.length;
    mocks.settings = { ...mocks.settings, values: { ...mocks.settings.values, blur: 3 } };
    await act(async () => renderer.update(createElement(WallpaperSettingsSection, props)));
    expect(rpc("read")).toHaveBeenCalledTimes(calls);
  });
});
