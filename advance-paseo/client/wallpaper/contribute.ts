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
import { resolveWallpaperImagesWith } from "./loader";
import { PALETTE_PAIRS } from "./palettes";

export function contributeWallpaper(client: PluginClientContext): () => void {
  PALETTE_PAIRS.forEach((pair, index) => {
    // The engine installs as a side effect of the first addTheme call so it
    // exists before any theme can be selected; it stays dormant until both a
    // mode is detected and the matching image slot is populated.
    client.addTheme(index === 0 ? installWallpaperEngine(pair.light) : pair.light);
    client.addTheme(pair.dark);
  });

  // Apply persisted preferences and wallpaper images as soon as the host can
  // serve them; failures keep the engine dormant instead of breaking the
  // client entry.
  void client
    .rpc(wallpaperSettingsRpc.read, {})
    .then(async (read) => {
      if (read.status !== "ready") return;
      const settings = parseWallpaperSettings(read.values);
      applyWallpaperState(engineStateOf(settings));
      const images = await resolveWallpaperImagesWith(
        {
          readManaged: (id) =>
            client.rpc(wallpaperReadRpc, { id }).then((result) => result.dataUrl),
          readPath: (path) =>
            client.rpc(wallpaperReadPathRpc, { path }).then((result) => result.dataUrl),
        },
        settings,
      );
      setWallpaperImages(images);
    })
    .catch((error) => {
      console.error("[advance-paseo] wallpaper init failed", error);
    });

  return () => removeWallpaperEngine();
}
