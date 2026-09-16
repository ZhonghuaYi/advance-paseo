// Wallpaper mode resolution from host theme signals.
//
// The host runs react-native-unistyles in CSSVars mode: the ACTIVE theme is
// named by a class on <html> (light, dark, darkZinc, …, pluginLight,
// pluginDark) or, in "auto" mode, by the OS color-scheme preference with no
// class at all. Reading these signals is deterministic and instant — unlike
// the previous approach of sampling painted surface colors, which the
// wallpaper itself defeats (our variable overrides make those surfaces
// transparent, so there is nothing left to sample).
//
// The resolution is pure so it can be unit-tested; the DOM reading lives in
// the engine.

export type WallpaperMode = "light" | "dark";
export type WallpaperStrategy = "system" | "all";

/** Theme signals read from the document, pre-normalized. */
export interface HostThemeSignals {
  /** Set when a plugin-contributed theme is active (pluginLight/pluginDark). */
  readonly pluginTheme: WallpaperMode | null;
  /** Set when a built-in theme class names the palette family. */
  readonly builtinTheme: WallpaperMode | null;
  /** OS preference, consulted only when no theme class is present ("auto"). */
  readonly prefersDark: boolean;
}

/**
 * Which wallpaper slot may paint, or null for "off".
 *
 * - "system": the wallpaper paints on built-in themes only; selecting one of
 *   this plugin's own (or any plugin's) themes means the user chose a plain
 *   color palette and the wallpaper turns off.
 * - "all": paints over every theme, following its light/dark family.
 */
export function resolveWallpaperMode(
  signals: HostThemeSignals,
  strategy: WallpaperStrategy,
): WallpaperMode | null {
  if (signals.pluginTheme !== null) {
    return strategy === "system" ? null : signals.pluginTheme;
  }
  if (signals.builtinTheme !== null) return signals.builtinTheme;
  return signals.prefersDark ? "dark" : "light";
}
