import { describe, expect, it } from "vitest";
import {
  languageSettingsSchema,
  LANGUAGE_SETTINGS_DEFAULTS,
  parseLanguageSettings,
} from "./i18n";

describe("languageSettingsSchema", () => {
  it("defaults to auto", () => {
    expect(LANGUAGE_SETTINGS_DEFAULTS).toEqual({ language: "auto" });
  });

  it("accepts each supported language", () => {
    for (const language of ["auto", "en", "zh"] as const) {
      expect(languageSettingsSchema.parse({ language })).toEqual({ language });
    }
  });

  it("rejects unsupported languages", () => {
    expect(languageSettingsSchema.safeParse({ language: "jp" }).success).toBe(false);
  });

  it("falls back to defaults on invalid stored values", () => {
    expect(parseLanguageSettings({ language: 42 })).toEqual(LANGUAGE_SETTINGS_DEFAULTS);
    expect(parseLanguageSettings(null)).toEqual(LANGUAGE_SETTINGS_DEFAULTS);
  });
});
