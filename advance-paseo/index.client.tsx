// App-side entry: aggregates every feature module's client contribution,
// registers the shared settings screen, and exposes a Command Center action
// to open it. Static registrations use the entry-time detected language; the
// settings screen itself swaps dictionaries live.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AdvanceSettingsScreen } from "./client/settings-screen";
import { contributeI18n } from "./client/i18n/contribute";
import { contributeLiveChat } from "./client/live-chat/contribute";
import { contributeProvidersAutoRefresh } from "./client/providers/contribute";
import { contributeWallpaper } from "./client/wallpaper/contribute";
import { getText } from "./client/i18n/store";

export const ADVANCE_SETTINGS_SCREEN_ID = "advance-settings";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    contributeI18n(client),
    contributeWallpaper(client),
    contributeProvidersAutoRefresh(client),
    contributeLiveChat(client),
  ];

  client.addSettingsScreen({
    id: ADVANCE_SETTINGS_SCREEN_ID,
    title: "Advance Paseo",
    icon: "Sparkles",
    Component: AdvanceSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "open-advance-settings",
    title: getText().command.openSettings,
    icon: "Sparkles",
    context: "workspace",
    onSelect: () => client.openSettings(ADVANCE_SETTINGS_SCREEN_ID),
  });

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
