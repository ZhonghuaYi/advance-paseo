import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteWallpaper, listWallpapers, readWallpaper, uploadWallpaper } from "./wallpaper-store";

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(tmpdir(), "advance-paseo-test-"));
  vi.stubEnv("PASEO_HOME", home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // Only remove the specific test directory created by mkdtemp.
  if (path.dirname(home) !== path.resolve(tmpdir()) || !path.basename(home).startsWith("advance-paseo-test-")) {
    throw new Error("Unexpected test directory");
  }
  await fs.rm(home, { recursive: true, force: true });
});
const upload = (name: string) => uploadWallpaper({ name, dataUrl: "data:image/png;base64,YQ==" });

describe("wallpaper index transactions", () => {
  it("retains every concurrent upload to an existing index", async () => {
    await upload("seed");
    const added = await Promise.all(Array.from({ length: 12 }, (_, i) => upload(String(i))));
    expect((await listWallpapers()).items).toHaveLength(13);
    for (const { wallpaper } of added) expect((await readWallpaper({ id: wallpaper.id })).dataUrl).toContain("YQ==");
  });
  it("does not resurrect a deleted entry when an upload overlaps", async () => {
    const { wallpaper } = await upload("delete me");
    await Promise.all([deleteWallpaper({ id: wallpaper.id }), upload("keep me"), upload("keep too")]);
    const { items } = await listWallpapers();
    expect(items.map(item => item.name).sort()).toEqual(["keep me", "keep too"]);
    expect(await deleteWallpaper({ id: wallpaper.id })).toEqual({ deleted: false });
  });
  it("cleans a failed upload and permits the next transaction", async () => {
    await upload("seed");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk failure"));
    await expect(upload("failed")).rejects.toThrow("disk failure");
    await upload("next");
    expect((await listWallpapers()).items.map(item => item.name).sort()).toEqual(["next", "seed"]);
    expect((await fs.readdir(path.join(home, "advance-paseo", "wallpapers"))).sort()).toHaveLength(3);
  });
  it("does not share mutable empty indexes across directories", async () => {
    await upload("old directory");
    vi.stubEnv("PASEO_HOME", path.join(home, "another"));
    await upload("new directory");
    expect((await listWallpapers()).items.map(item => item.name)).toEqual(["new directory"]);
  });
});
