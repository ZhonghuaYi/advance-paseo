// Daemon-side entry: aggregates every feature module's server contribution.

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerProvidersWatcher } from "./server/providers-watch";
import { registerWallpaperStore } from "./server/wallpaper-store";
import { providersSettings } from "./shared/providers";
import { languageSettings } from "./shared/i18n";
import { wallpaperSettings } from "./shared/wallpaper";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(wallpaperSettings);
  server.registerSettings(providersSettings);
  server.registerSettings(languageSettings);

  const disposeWallpaper = registerWallpaperStore(server);
  const disposeProviders = registerProvidersWatcher(server);

  return () => {
    disposeProviders();
    disposeWallpaper();
  };
}
