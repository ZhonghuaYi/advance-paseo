// Daemon-side entry: aggregates every feature module's server contribution.

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerProvidersWatcher } from "./server/providers-watch";
import { registerWallpaperStore } from "./server/wallpaper-store";
import { providersSettings } from "./shared/providers";
import { languageSettings } from "./shared/i18n";
import { liveChatSettings } from "./shared/live-chat";
import { wallpaperDebugRpc, wallpaperSettings } from "./shared/wallpaper";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(wallpaperSettings);
  server.registerSettings(providersSettings);
  server.registerSettings(languageSettings);
  server.registerSettings(liveChatSettings);

  // TEMPORARY diagnostics channel; remove after the wallpaper investigation.
  server.handle(wallpaperDebugRpc, (input) => {
    console.log(`[advance-paseo][diag] ${input.report.replaceAll("\n", " | ")}`);
    return { ok: true };
  });

  const disposeWallpaper = registerWallpaperStore(server);
  const disposeProviders = registerProvidersWatcher(server);

  return () => {
    disposeProviders();
    disposeWallpaper();
  };
}
