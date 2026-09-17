import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEME_OPTIONS,
  isActiveBuiltin,
  isActivePluginTheme,
  PLUGIN_THEME_OPTIONS,
} from "./catalog";
import {
  mergeAppSettingsTheme,
  parseAppThemePreference,
  themeClassFor,
} from "./app-theme";
import { buttonIdSuffix, ALL_THEME_CLASSES } from "./catalog";
import { PALETTE_PAIRS } from "../wallpaper/palettes";

describe("theme catalog", () => {
  it("lists the host's built-in theme preferences", () => {
    expect(BUILTIN_THEME_OPTIONS.map((option) => option.preference)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
  });

  it("derives plugin entries from the registered palette pairs", () => {
    expect(PLUGIN_THEME_OPTIONS).toEqual(
      PALETTE_PAIRS.flatMap((pair) => [
        {
          preference: "plugin",
          pluginThemeId: pair.light.id,
          name: pair.light.name,
          swatch: pair.light.colors.background,
          appearance: "light",
        },
        {
          preference: "plugin",
          pluginThemeId: pair.dark.id,
          name: pair.dark.name,
          swatch: pair.dark.colors.background,
          appearance: "dark",
        },
      ]),
    );
    // Every selectable entry is addressable by a unique key.
    const ids = PLUGIN_THEME_OPTIONS.map((option) => option.pluginThemeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the active preference exactly", () => {
    const dark = BUILTIN_THEME_OPTIONS[1];
    expect(isActiveBuiltin(dark, { theme: "dark", pluginThemeId: null })).toBe(true);
    expect(isActiveBuiltin(dark, { theme: "light", pluginThemeId: null })).toBe(false);
    expect(isActiveBuiltin(dark, null)).toBe(false);

    const cream = PLUGIN_THEME_OPTIONS[0];
    expect(
      isActivePluginTheme(cream, {
        theme: "plugin",
        pluginThemeId: cream.pluginThemeId,
      }),
    ).toBe(true);
    // A built-in preference must not highlight a plugin theme and vice versa.
    expect(isActivePluginTheme(cream, { theme: "light", pluginThemeId: null })).toBe(false);
    expect(
      isActiveBuiltin(dark, {
        theme: "plugin",
        pluginThemeId: cream.pluginThemeId,
      }),
    ).toBe(false);
  });
});

describe("button id sanitization", () => {
  it("turns workspace ids into host-valid button id suffixes", () => {
    // The host validates button ids against /^[a-z][a-z0-9-]*$/; real
    // workspace ids contain underscores ("wks_ca0cd12d5de8c6d0") and would
    // otherwise make addHeaderButton throw.
    const buttonIdPattern = /^[a-z][a-z0-9-]*$/;
    for (const [workspaceId, expected] of [
      ["wks_ca0cd12d5de8c6d0", "wks-ca0cd12d5de8c6d0"],
      ["wks__UPPER_x", "wks-upper-x"],
      ["  wks-plain  ", "wks-plain"],
      ["___", ""],
    ] as const) {
      const suffix = buttonIdSuffix(workspaceId);
      expect(suffix).toBe(expected);
      expect(`advance-theme-switcher-${suffix}`).toMatch(buttonIdPattern);
    }
  });
});

describe("app-settings preference plumbing", () => {
  it("parses stored preferences defensively", () => {
    expect(parseAppThemePreference(null)).toBeNull();
    expect(parseAppThemePreference("not json")).toBeNull();
    expect(parseAppThemePreference("42")).toBeNull();
    expect(parseAppThemePreference('{"pluginThemeId":"advance-cream"}')).toBeNull();
    expect(parseAppThemePreference('{"theme":"dark"}')).toEqual({
      theme: "dark",
      pluginThemeId: null,
    });
    expect(
      parseAppThemePreference('{"theme":"plugin","pluginThemeId":"advance-cream"}'),
    ).toEqual({ theme: "plugin", pluginThemeId: "advance-cream" });
  });

  it("merges the preference patch without touching other settings", () => {
    const merged = mergeAppSettingsTheme(
      { theme: "auto", pluginThemeId: null, language: "zh", codeFontSize: 14 },
      { theme: "plugin", pluginThemeId: "advance-indigo" },
    );
    expect(merged).toEqual({
      theme: "plugin",
      pluginThemeId: "advance-indigo",
      language: "zh",
      codeFontSize: 14,
    });
    // Non-object current values merge onto an empty document.
    expect(mergeAppSettingsTheme(undefined, { theme: "zinc", pluginThemeId: null })).toEqual({
      theme: "zinc",
      pluginThemeId: null,
    });
  });
});

describe("theme class mapping", () => {
  it("maps built-in preferences to the host's unistyles theme classes", () => {
    for (const preference of ["light", "dark", "zinc", "midnight", "claude", "ghostty", "pureBlack"]) {
      expect(themeClassFor({ theme: preference, pluginThemeId: null }, "light")).toBe(
        preference,
      );
    }
  });

  it("maps auto to no class so the OS media rules decide", () => {
    expect(themeClassFor({ theme: "auto", pluginThemeId: null }, "light")).toBeNull();
  });

  it("maps plugin preferences through the contributed appearance", () => {
    expect(themeClassFor({ theme: "plugin", pluginThemeId: "x" }, "light")).toBe("pluginLight");
    expect(themeClassFor({ theme: "plugin", pluginThemeId: "x" }, "dark")).toBe("pluginDark");
  });

  it("only ever produces theme classes the host actually registered", () => {
    const preferences = [
      ...BUILTIN_THEME_OPTIONS.map((option) => option.preference),
      "plugin",
      "unknown-garbage",
    ];
    for (const preference of preferences) {
      for (const appearance of ["light", "dark"] as const) {
        const themeClass = themeClassFor({ theme: preference, pluginThemeId: "x" }, appearance);
        if (themeClass !== null) {
          expect(ALL_THEME_CLASSES).toContain(themeClass);
        }
      }
    }
    expect(themeClassFor({ theme: "unknown-garbage", pluginThemeId: null }, "light")).toBeNull();
  });
});
