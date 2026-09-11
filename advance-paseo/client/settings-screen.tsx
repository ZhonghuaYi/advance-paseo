// The Advance Paseo settings screen: one section per feature module. New
// features add their section here and nothing else changes.

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ProvidersSettingsSection } from "./providers/settings-ui";
import { WallpaperSettingsSection } from "./wallpaper/settings-ui";

export function AdvanceSettingsScreen(props: PluginSurfaceProps) {
  return (
    <>
      <WallpaperSettingsSection {...props} />
      <ProvidersSettingsSection {...props} />
    </>
  );
}
