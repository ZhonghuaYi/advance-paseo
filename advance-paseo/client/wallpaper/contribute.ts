// Wallpaper feature contribution: registers every palette pair as an
// official Paseo theme (the engine installs alongside the first one, exactly
// like the Miku plugin it descends from) and applies persisted settings plus
// the active wallpaper images as soon as the host can serve them.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  wallpaperReadPathRpc,
  wallpaperReadRpc,
  wallpaperSettingsRpc,
  parseWallpaperSettings,
} from "../../shared/wallpaper";
import {
  applyWallpaperState,
  engineStateOf,
  installWallpaperEngine,
  removeWallpaperEngine,
  setWallpaperImages,
} from "./engine";
import { resolveWallpaperImagesWith, type WallpaperReader } from "./loader";
import { PALETTE_PAIRS } from "./palettes";

/** Backoff schedule for the startup read (settings + images). */
const INIT_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000];

/**
 * Apply persisted preferences and wallpaper images as soon as the host can
 * serve them. Retried with backoff: the contribution can run before the
 * client's connection is ready, and
 * a transient file-read failure must not leave the engine imageless until the
 * settings screen happens to be opened. Every step is idempotent, so a retry
 * after a partial success just re-applies the same state.
 */
async function initWallpaperRuntime(
  client: PluginClientContext,
  isDisposed: () => boolean,
): Promise<void> {
  const reader: WallpaperReader = {
    readManaged: (id) =>
      client.rpc(wallpaperReadRpc, { id }).then((result) => result.dataUrl),
    readPath: (path) =>
      client.rpc(wallpaperReadPathRpc, { path }).then((result) => result.dataUrl),
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      if (!isDisposed()) {
        const read = await client.rpc(wallpaperSettingsRpc.read, {});
        if (read.status === "ready") {
          const settings = parseWallpaperSettings(read.values);
          applyWallpaperState(engineStateOf(settings));
          const resolution = await resolveWallpaperImagesWith(reader, settings);
          setWallpaperImages(resolution.images);
          if (!resolution.failed) return;
        }
      }
    } catch (error) {
      console.error("[advance-paseo] wallpaper init failed", error);
    }
    if (isDisposed() || attempt >= INIT_RETRY_DELAYS_MS.length) {
      if (!isDisposed()) {
        console.error(
          "[advance-paseo] wallpaper init gave up; opening the settings screen retries the read",
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAYS_MS[attempt]));
  }
}

export function contributeWallpaper(client: PluginClientContext): () => void {
  PALETTE_PAIRS.forEach((pair, index) => {
    // The engine installs as a side effect of the first addTheme call so it
    // exists before any theme can be selected; it stays dormant until both a
    // mode is detected and the matching image slot is populated.
    client.addTheme(index === 0 ? installWallpaperEngine(pair.light) : pair.light);
    client.addTheme(pair.dark);
  });

  let disposed = false;
  void initWallpaperRuntime(client, () => disposed);

  return () => {
    disposed = true;
    removeWallpaperEngine();
  };
}
