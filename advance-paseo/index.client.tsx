// App-side entry: aggregates every feature module's client contribution,
// registers the shared settings screen, and exposes a Command Center action
// to open it.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AdvanceSettingsScreen } from "./client/settings-screen";
import { contributeProvidersAutoRefresh } from "./client/providers/contribute";
import { contributeWallpaper } from "./client/wallpaper/contribute";

export const ADVANCE_SETTINGS_SCREEN_ID = "advance-settings";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    contributeWallpaper(client),
    contributeProvidersAutoRefresh(client),
  ];

  client.addSettingsScreen({
    id: ADVANCE_SETTINGS_SCREEN_ID,
    title: "Advance Paseo",
    icon: "Sparkles",
    Component: AdvanceSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "open-advance-settings",
    title: "Open Advance Paseo settings",
    icon: "Sparkles",
    context: "workspace",
    onSelect: () => client.openSettings(ADVANCE_SETTINGS_SCREEN_ID),
  });

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
