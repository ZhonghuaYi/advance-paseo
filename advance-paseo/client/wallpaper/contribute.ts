// Wallpaper feature contribution: registers every palette pair as an
// official Paseo theme. Wallpaper installation and reads are separately
// gated on this installation matching the desktop's local daemon identity.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  wallpaperReadPathRpc,
  wallpaperHostRpc,
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
  verifyWallpaperHost,
} from "./engine";
import { getLocalWallpaperHostId } from "../web";
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
 * Verify desktop and installation identities before installing the engine or
 * reading settings/images. Unknown identities retry; remote identities stop.
 */
async function initWallpaperRuntime(
  client: PluginClientContext,
  isDisposed: () => boolean,
  wait: (delay: number) => Promise<void>,
): Promise<void> {
  let verified = false;
  const reader: WallpaperReader = {
    readManaged: (id) =>
      client.rpc(wallpaperReadRpc, { id }).then((result) => result.dataUrl),
    readPath: (path) =>
      client.rpc(wallpaperReadPathRpc, { path }).then((result) => result.dataUrl),
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      if (!isDisposed()) {
        if (!verified) {
          const localId = await getLocalWallpaperHostId();
          if (isDisposed()) return;
          if (!localId) throw new Error("Local desktop daemon identity unavailable");
          const host = await client.rpc(wallpaperHostRpc, {});
          if (isDisposed()) return;
          if (!host.serverId) throw new Error("Plugin daemon identity unavailable");
          if (!verifyWallpaperHost(host.serverId, localId)) return;
          installWallpaperEngine(PALETTE_PAIRS[0].light);
          verified = true;
        }
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
  PALETTE_PAIRS.forEach((pair) => {
    client.addTheme(pair.light);
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
