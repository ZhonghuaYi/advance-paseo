import { describe, expect, it } from "vitest";
import {
  resolveWallpaperMode,
  type HostThemeSignals,
} from "./theme-detect";

const signals = (overrides: Partial<HostThemeSignals> = {}): HostThemeSignals => ({
  pluginTheme: null,
  builtinTheme: null,
  prefersDark: false,
  ...overrides,
});

describe("resolveWallpaperMode", () => {
  it("turns the wallpaper off for plugin themes in system mode", () => {
    expect(resolveWallpaperMode(signals({ pluginTheme: "light" }), "system")).toBeNull();
    expect(resolveWallpaperMode(signals({ pluginTheme: "dark" }), "system")).toBeNull();
  });

  it("paints plugin themes in all mode, following their family", () => {
    expect(resolveWallpaperMode(signals({ pluginTheme: "light" }), "all")).toBe("light");
    expect(resolveWallpaperMode(signals({ pluginTheme: "dark" }), "all")).toBe("dark");
  });

  it("follows built-in theme classes in both strategies", () => {
    for (const strategy of ["system", "all"] as const) {
      expect(resolveWallpaperMode(signals({ builtinTheme: "light" }), strategy)).toBe("light");
      expect(resolveWallpaperMode(signals({ builtinTheme: "dark" }), strategy)).toBe("dark");
    }
  });

  it("falls back to the OS preference when no theme class is present", () => {
    expect(resolveWallpaperMode(signals({ prefersDark: true }), "system")).toBe("dark");
    expect(resolveWallpaperMode(signals({ prefersDark: false }), "all")).toBe("light");
  });

  it("prefers the plugin signal over built-in and OS signals", () => {
    expect(
      resolveWallpaperMode(
        signals({ pluginTheme: "dark", builtinTheme: "light", prefersDark: false }),
        "all",
      ),
    ).toBe("dark");
    // A plugin theme always wins, even alongside built-in classes.
    expect(
      resolveWallpaperMode(signals({ pluginTheme: "light", builtinTheme: "dark" }), "all"),
    ).toBe("light");
  });
});
