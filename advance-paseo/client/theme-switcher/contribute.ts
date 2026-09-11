// Theme-switcher contribution: one header button per known workspace. Header
// buttons are matched to the open workspace by id, so the button is
// registered for every workspace returned by the initial list and for every
// workspace the daemon later streams through workspace updates.

import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { getText } from "../i18n/store";
import { ThemeSwitcherPopover } from "./popover";

export function contributeThemeSwitcher(client: PluginClientContext): () => void {
  const registrations = new Map<string, PluginButtonRegistration>();
  const buttonTitle = getText().themeSwitcher.buttonTitle;

  const ensureButton = (rawWorkspaceId: string): void => {
    const workspaceId = rawWorkspaceId.trim();
    if (workspaceId.length === 0 || registrations.has(workspaceId)) return;
    try {
      const registration = client.addHeaderButton({
        id: `advance-theme-switcher-${workspaceId}`,
        workspaceId,
        button: {
          title: buttonTitle,
          icon: "Palette",
          behavior: { kind: "popover", Content: ThemeSwitcherPopover },
        },
      });
      registrations.set(workspaceId, registration);
    } catch (error) {
      console.error("[advance-paseo] theme switcher registration failed", error);
    }
  };

  // Initial pass over existing workspaces; `subscribe` also asks the daemon
  // to start streaming workspace updates for the SDK listener below.
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      for (const workspace of result.entries) ensureButton(workspace.id);
    })
    .catch((error: unknown) => {
      console.error("[advance-paseo] theme switcher could not list workspaces", error);
    });

  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind !== "upsert") return;
    const workspaceId = update.workspace.id;
    if (typeof workspaceId === "string") ensureButton(workspaceId);
  });

  return () => {
    unsubscribe();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
  };
}
