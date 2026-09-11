import { describe, expect, it } from "vitest";
import {
  parseWallpaperSettings,
  WALLPAPER_SETTINGS_DEFAULTS,
  wallpaperSettingsSchema,
} from "./wallpaper";

describe("wallpaperSettingsSchema", () => {
  it("defaults to enabled plugin-themes mode with empty slots", () => {
    expect(WALLPAPER_SETTINGS_DEFAULTS).toEqual({
      enabled: true,
      mode: "plugin-themes",
      scrim: "balanced",
      blur: "strong",
      accent: "graphite",
      light: null,
      dark: null,
    });
  });

  it("accepts managed and path slot sources", () => {
    const parsed = wallpaperSettingsSchema.parse({
      light: { kind: "managed", id: "uuid-1" },
      dark: { kind: "path", path: "~/pictures/bg.webp" },
    });
    expect(parsed.light).toEqual({ kind: "managed", id: "uuid-1" });
    expect(parsed.dark).toEqual({ kind: "path", path: "~/pictures/bg.webp" });
  });

  it("falls back to defaults on invalid stored values", () => {
    expect(parseWallpaperSettings({ mode: "dark-mode" })).toEqual(WALLPAPER_SETTINGS_DEFAULTS);
    expect(parseWallpaperSettings(null)).toEqual(WALLPAPER_SETTINGS_DEFAULTS);
    expect(parseWallpaperSettings("junk")).toEqual(WALLPAPER_SETTINGS_DEFAULTS);
  });

  it("rejects unknown slot kinds", () => {
    expect(
      wallpaperSettingsSchema.safeParse({ light: { kind: "url", url: "https://" } }).success,
    ).toBe(false);
  });

  it("round-trips style options", () => {
    const parsed = wallpaperSettingsSchema.parse({
      scrim: "vivid",
      blur: "off",
      accent: "magenta",
      enabled: false,
    });
    expect(parsed).toMatchObject({
      scrim: "vivid",
      blur: "off",
      accent: "magenta",
      enabled: false,
    });
  });
});
