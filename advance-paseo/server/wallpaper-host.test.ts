import { afterEach, expect, it, vi } from "vitest";
const readFile = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ promises: { readFile } }));
import { readWallpaperHostId } from "./wallpaper-host";
afterEach(() => { vi.unstubAllEnvs(); readFile.mockReset(); });
it("uses the daemon's explicit identity override", async () => {
  vi.stubEnv("PASEO_SERVER_ID", " explicit-id ");
  expect(await readWallpaperHostId()).toBe("explicit-id");
  expect(readFile).not.toHaveBeenCalled();
});
it("reads the identity in the daemon home without generating a new one", async () => {
  vi.stubEnv("PASEO_SERVER_ID", "");
  vi.stubEnv("PASEO_HOME", "test-daemon-home");
  readFile.mockResolvedValue("srv_local\n");
  expect(await readWallpaperHostId()).toBe("srv_local");
  expect(readFile).toHaveBeenCalledWith(expect.stringMatching(/test-daemon-home[/\\]server-id$/), "utf8");
});
it("returns unknown when the identity cannot be read", async () => {
  vi.stubEnv("PASEO_SERVER_ID", "");
  readFile.mockRejectedValue(new Error("missing"));
  expect(await readWallpaperHostId()).toBeNull();
  readFile.mockResolvedValue("\n");
  expect(await readWallpaperHostId()).toBeNull();
});
