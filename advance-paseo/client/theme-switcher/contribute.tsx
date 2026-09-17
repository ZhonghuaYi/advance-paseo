// Theme-switcher contribution: one header button per known workspace. Header
// buttons are matched to the open workspace by id, so the button is
// registered for every workspace returned by the initial list and for every
// workspace the daemon later streams through workspace updates.

import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { getText } from "../i18n/store";
import { readHostThemeSignals } from "../wallpaper/engine";
import { resolveWallpaperMode } from "../wallpaper/theme-detect";
import { ThemeSwitcherPopover } from "./popover";
import { buttonIdSuffix } from "./catalog";

const LIST_ATTEMPTS = 3;
const LIST_RETRY_DELAY_MS = 2000;

/** Header icon tinted from the LIVE theme family on <html>, not the host's
 * JS-side theme prop (which lags behind our class flip and left a light-gray
 * icon on the light theme's header). */
function ThemedPaletteIcon(props: PluginButtonIconProps) {
  const family = resolveWallpaperMode(readHostThemeSignals(), "all") ?? "dark";
  return <Icon name="Palette" size={props.size} color={family === "light" ? "#6F655F" : "#C8CCD8"} />;
}

export function contributeThemeSwitcher(client: PluginClientContext): () => void {
  const registrations = new Map<string, PluginButtonRegistration>();
  const usedButtonIds = new Set<string>();
  const buttonTitle = getText().themeSwitcher.buttonTitle;
  let stopped = false;

  const ensureButton = (rawWorkspaceId: string): void => {
    const workspaceId = rawWorkspaceId.trim();
    if (stopped || workspaceId.length === 0 || registrations.has(workspaceId)) return;

    // The sanitized suffix can collide across distinct workspace ids; number
    // the duplicates. The match key stays the exact workspace id.
    const base = `advance-theme-switcher-${buttonIdSuffix(workspaceId)}`;
    let buttonId = base;
    let variant = 2;
    while (usedButtonIds.has(buttonId)) {
      buttonId = `${base}-${variant}`;
      variant += 1;
    }
    usedButtonIds.add(buttonId);

    try {
      const registration = client.addHeaderButton({
        id: buttonId,
        workspaceId,
        button: {
          title: buttonTitle,
          icon: ThemedPaletteIcon,
          behavior: { kind: "popover", Content: ThemeSwitcherPopover },
        },
      });
      registrations.set(workspaceId, registration);
    } catch (error) {
      usedButtonIds.delete(buttonId);
      console.error("[advance-paseo] theme switcher registration failed", error);
    }
  };

  // Initial pass over existing workspaces; `subscribe` also asks the daemon
  // to start streaming workspace updates for the SDK listener below. Retried
  // because the contribution can run before the client's connection is ready.
  const listWorkspaces = async (): Promise<void> => {
    for (let attempt = 0; attempt < LIST_ATTEMPTS; attempt += 1) {
      if (stopped) return;
      try {
        const result = await client.paseo.workspaces.list({ subscribe: {} });
        for (const workspace of result.entries) ensureButton(workspace.id);
        if (result.entries.length > 0) return;
      } catch (error) {
        console.error("[advance-paseo] theme switcher could not list workspaces", error);
      }
      await new Promise((resolve) => setTimeout(resolve, LIST_RETRY_DELAY_MS));
    }
  };
  void listWorkspaces();

  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind !== "upsert") return;
    const workspaceId = update.workspace.id;
    if (typeof workspaceId === "string") ensureButton(workspaceId);
  });

  return () => {
    stopped = true;
    unsubscribe();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
    usedButtonIds.clear();
  };
}
