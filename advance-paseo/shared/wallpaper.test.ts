import { describe, expect, it } from "vitest";
import {
  BLUR_RANGE,
  parseWallpaperSettings,
  SCRIM_RANGE,
  WALLPAPER_SETTINGS_DEFAULTS,
  wallpaperSettingsSchema,
} from "./wallpaper";

describe("wallpaperSettingsSchema", () => {
  it("defaults to enabled system-themes mode with empty slots", () => {
    expect(WALLPAPER_SETTINGS_DEFAULTS).toEqual({
      enabled: true,
      mode: "system",
      scrim: SCRIM_RANGE.default,
      blur: BLUR_RANGE.default,
      accent: "graphite",
      light: null,
      dark: null,
    });
  });

  it("migrates the legacy mode names on read", () => {
    expect(wallpaperSettingsSchema.parse({ mode: "plugin-themes" }).mode).toBe("system");
    expect(wallpaperSettingsSchema.parse({ mode: "any-theme" }).mode).toBe("all");
  });

  it("accepts managed and path slot sources", () => {
    const parsed = wallpaperSettingsSchema.parse({
      light: { kind: "managed", id: "uuid-1" },
      dark: { kind: "path", path: "~/pictures/bg.webp" },
    });
    expect(parsed.light).toEqual({ kind: "managed", id: "uuid-1" });
    expect(parsed.dark).toEqual({ kind: "path", path: "~/pictures/bg.webp" });
  });

  it("migrates the legacy three-step presets on read", () => {
    expect(wallpaperSettingsSchema.parse({ scrim: "subtle" }).scrim).toBe(125);
    expect(wallpaperSettingsSchema.parse({ scrim: "balanced" }).scrim).toBe(100);
    expect(wallpaperSettingsSchema.parse({ scrim: "vivid" }).scrim).toBe(78);
    expect(wallpaperSettingsSchema.parse({ blur: "off" }).blur).toBe(0);
    expect(wallpaperSettingsSchema.parse({ blur: "medium" }).blur).toBe(14);
    expect(wallpaperSettingsSchema.parse({ blur: "strong" }).blur).toBe(22);
    // Whole documents stored by older builds keep their slots.
    const migrated = wallpaperSettingsSchema.parse({
      scrim: "subtle",
      blur: "medium",
      light: { kind: "managed", id: "keep-me" },
    });
    expect(migrated).toMatchObject({
      scrim: 125,
      blur: 14,
      light: { kind: "managed", id: "keep-me" },
    });
  });

  it("round-trips numeric styling values", () => {
    const parsed = wallpaperSettingsSchema.parse({
      scrim: 65,
      blur: 9,
      accent: "magenta",
      enabled: false,
    });
    expect(parsed).toMatchObject({
      scrim: 65,
      blur: 9,
      accent: "magenta",
      enabled: false,
    });
  });

  it("rejects values outside the documented ranges", () => {
    expect(wallpaperSettingsSchema.safeParse({ scrim: SCRIM_RANGE.min - 1 }).success).toBe(false);
    expect(wallpaperSettingsSchema.safeParse({ scrim: SCRIM_RANGE.max + 1 }).success).toBe(false);
    expect(wallpaperSettingsSchema.safeParse({ blur: BLUR_RANGE.min - 1 }).success).toBe(false);
    expect(wallpaperSettingsSchema.safeParse({ blur: BLUR_RANGE.max + 1 }).success).toBe(false);
    expect(wallpaperSettingsSchema.safeParse({ scrim: 92.5 }).success).toBe(false);
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
});
