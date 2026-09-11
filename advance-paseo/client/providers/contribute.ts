// Providers auto-refresh feature contribution. The watcher itself lives in
// the daemon subprocess; arming it needs a Paseo session, which plugin
// handlers receive but the server entry does not. The client entry therefore
// arms the watcher once per client startup (and the settings screen re-arms
// it whenever the settings change).

import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  parseProvidersSettings,
  providersArmRpc,
  providersSettingsRpc,
} from "../../shared/providers";

export function contributeProvidersAutoRefresh(client: PluginClientContext): () => void {
  void client
    .rpc(providersSettingsRpc.read, {})
    .then((read) => {
      if (read.status !== "ready") return;
      return client.rpc(providersArmRpc, parseProvidersSettings(read.values));
    })
    .catch((error) => {
      console.error("[advance-paseo] providers watcher arm failed", error);
    });
  return () => {};
}
