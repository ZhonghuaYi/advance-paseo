// i18n feature contribution: registers the language settings document's
// client wiring — the persisted preference is applied to the store as soon
// as the host can serve it (the initial dictionary already matches the
// detected locale meanwhile).

import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  languageSettingsRpc,
  parseLanguageSettings,
} from "../../shared/i18n";
import { applyPreferredLanguage } from "./store";

export function contributeI18n(client: PluginClientContext): () => void {
  void client
    .rpc(languageSettingsRpc.read, {})
    .then((read) => {
      if (read.status === "ready") {
        applyPreferredLanguage(parseLanguageSettings(read.values).language);
      }
    })
    .catch((error) => {
      console.error("[advance-paseo] language init failed", error);
    });
  return () => {};
}
