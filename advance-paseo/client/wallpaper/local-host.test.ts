// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { getLocalWallpaperHostId } from "../web";

afterEach(() => { Reflect.deleteProperty(window, "paseoDesktop"); vi.useRealTimers(); });
it("reads the local desktop status, without changing daemon state", async () => {
  const invoke = vi.fn(async () => ({ status: "running", serverId: " local-id " }));
  Reflect.set(window, "paseoDesktop", { invoke });
  expect(await getLocalWallpaperHostId()).toBe("local-id");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("desktop_daemon_status");
});
it("does not guess a host in a browser without the desktop bridge", async () => {
  expect(await getLocalWallpaperHostId()).toBeNull();
});
it.each([null, {}, { status: "running", serverId: " " },
  { status: "stopped", serverId: "local" }, { status: "running", serverId: 42 }])(
  "rejects unavailable or malformed status %j", async status => {
    Reflect.set(window, "paseoDesktop", { invoke: async () => status });
    expect(await getLocalWallpaperHostId()).toBeNull();
  },
);
it("fails closed when the bridge errors", async () => {
  Reflect.set(window, "paseoDesktop", { invoke: async () => { throw new Error("unsupported"); } });
  expect(await getLocalWallpaperHostId()).toBeNull();
});
it("bounds a stalled bridge call and ignores its late result", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  Reflect.set(window, "paseoDesktop", { invoke: () => new Promise(resolve => { finish = resolve; }) });
  const result = getLocalWallpaperHostId();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await result).toBeNull();
  finish({ status: "running", serverId: "local" });
  expect(await result).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
