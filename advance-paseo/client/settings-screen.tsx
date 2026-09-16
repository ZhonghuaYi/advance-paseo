// The Advance Paseo settings screen: one section per feature module. New
// features add their section here and nothing else changes. All sections
// pull their text from the i18n store, so they re-render in the selected
// language.
//
// The root testID is the wallpaper engine's hook for glassing the host
// settings screen while this plugin's settings are open; the cards carry
// advance-settings-card for the sheet-glass treatment.

import { View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { LanguageSettingsSection } from "./i18n/settings-ui";
import { LiveChatSettingsSection } from "./live-chat/settings-ui";
import { ProvidersSettingsSection } from "./providers/settings-ui";
import { WallpaperSettingsSection } from "./wallpaper/settings-ui";

export const ADVANCE_SETTINGS_ROOT_TEST_ID = "advance-settings-root";

export function AdvanceSettingsScreen(props: PluginSurfaceProps) {
  return (
    <View testID={ADVANCE_SETTINGS_ROOT_TEST_ID}>
      <LanguageSettingsSection {...props} />
      <WallpaperSettingsSection {...props} />
      <ProvidersSettingsSection {...props} />
      <LiveChatSettingsSection {...props} />
    </View>
  );
}
