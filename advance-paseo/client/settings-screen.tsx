// The Advance Paseo settings screen: one section per feature module. New
// features add their section here and nothing else changes. All sections
// pull their text from the i18n store, so they re-render in the selected
// language.

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { LanguageSettingsSection } from "./i18n/settings-ui";
import { ProvidersSettingsSection } from "./providers/settings-ui";
import { WallpaperSettingsSection } from "./wallpaper/settings-ui";

export function AdvanceSettingsScreen(props: PluginSurfaceProps) {
  return (
    <>
      <LanguageSettingsSection {...props} />
      <WallpaperSettingsSection {...props} />
      <ProvidersSettingsSection {...props} />
    </>
  );
}
