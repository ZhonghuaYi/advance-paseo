// Shared contracts for the plugin's interface language. The dictionaries
// themselves live client-side (client/i18n/dictionaries.ts); this module only
// defines the persisted preference so both runtimes agree on its shape.

import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** "auto" resolves from the app/system locale; the others pin the language. */
export const languageSettingsSchema = z.object({
  language: z.enum(["auto", "en", "zh"]).default("auto"),
});

export type LanguagePreference = z.infer<typeof languageSettingsSchema>["language"];

/** Languages the plugin ships dictionaries for. */
export type PluginLanguage = "en" | "zh";

export const languageSettings = defineSettings({
  id: "advance-language",
  scope: "host",
  version: 1,
  schema: languageSettingsSchema,
});

export type LanguageSettings = z.infer<typeof languageSettingsSchema>;

export const LANGUAGE_SETTINGS_DEFAULTS: LanguageSettings =
  languageSettingsSchema.parse({});

export const LANGUAGE_SETTINGS_ID = "advance-language";

export const languageSettingsRpc = settingsRpc(LANGUAGE_SETTINGS_ID);

export function parseLanguageSettings(values: unknown): LanguageSettings {
  const result = languageSettingsSchema.safeParse(values);
  return result.success ? result.data : LANGUAGE_SETTINGS_DEFAULTS;
}
