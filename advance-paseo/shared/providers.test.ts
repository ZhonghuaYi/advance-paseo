import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATCH_PATHS,
  parseProvidersSettings,
  providersSettingsSchema,
  PROVIDERS_SETTINGS_DEFAULTS,
} from "./providers";

describe("providersSettingsSchema", () => {
  it("defaults to Claude Code's config files", () => {
    expect(PROVIDERS_SETTINGS_DEFAULTS.watchPaths).toEqual([...DEFAULT_WATCH_PATHS]);
    expect(PROVIDERS_SETTINGS_DEFAULTS.enabled).toBe(true);
    expect(PROVIDERS_SETTINGS_DEFAULTS.debounceMs).toBe(1500);
  });

  it("preserves a custom watch list", () => {
    const parsed = providersSettingsSchema.parse({
      watchPaths: ["~/.codex/config.toml"],
      debounceMs: 500,
    });
    expect(parsed.watchPaths).toEqual(["~/.codex/config.toml"]);
    expect(parsed.debounceMs).toBe(500);
  });

  it("clamps debounce into range by rejecting out-of-range values", () => {
    expect(providersSettingsSchema.safeParse({ debounceMs: 10 }).success).toBe(false);
    expect(providersSettingsSchema.safeParse({ debounceMs: 99999 }).success).toBe(false);
  });

  it("falls back to defaults on invalid stored values", () => {
    expect(parseProvidersSettings({ debounceMs: "soon" })).toEqual(PROVIDERS_SETTINGS_DEFAULTS);
    expect(parseProvidersSettings(undefined)).toEqual(PROVIDERS_SETTINGS_DEFAULTS);
  });

  it("rejects empty path entries", () => {
    expect(providersSettingsSchema.safeParse({ watchPaths: [""] }).success).toBe(false);
  });
});
