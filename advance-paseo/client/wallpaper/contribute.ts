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
  beginWallpaperImages,
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
 *
 * Writes carry the "bootstrap" origin: with several hosts connected, only
 * the FIRST one to initialize owns the window's wallpaper (the client's own
 * daemon in practice) — later hosts' background applies are rejected, and a
 * rejection ends the retry loop because it can never succeed. Opening a
 * host's Advance settings screen deliberately re-targets the window.
 */
async function initWallpaperRuntime(
  client: PluginClientContext,
  isDisposed: () => boolean,
  wait: (delay: number) => Promise<void>,
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
        if (isDisposed()) return;
        if (read.status === "ready") {
          const settings = parseWallpaperSettings(read.values);
          const outcome = applyWallpaperState(engineStateOf(settings), "bootstrap");
          if (outcome === "rejected") {
            console.info(
              "[advance-paseo] another host already drives this window's wallpaper; skipping this host's background apply",
            );
            return;
          }
          if (outcome === "applied") {
            const request = beginWallpaperImages(settings, "bootstrap");
            if (!request) return;
            const resolution = await resolveWallpaperImagesWith(reader, settings);
            if (isDisposed() || !request.apply(resolution.images)) return;
            if (!resolution.failed) return;
          }
          // "deferred": the engine is not installed yet — retry below.
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
    await wait(INIT_RETRY_DELAYS_MS[attempt]);
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  const wait = (delay: number) => new Promise<void>(resolve => {
    wake = resolve;
    timer = setTimeout(() => { timer = null; wake = null; resolve(); }, delay);
  });
  if (typeof document !== "undefined") void initWallpaperRuntime(client, () => disposed, wait);

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    wake?.();
    timer = null;
    wake = null;
    removeWallpaperEngine();
  };
}
