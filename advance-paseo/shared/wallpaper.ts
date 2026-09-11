// Shared contracts for the wallpaper feature: the host-scoped settings
// document plus the RPCs the client uses to manage daemon-side wallpaper
// files. Kept free of Node and React Native imports so both runtimes can
// bundle it.

import { defineRpc, defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Where a wallpaper slot gets its image from. */
export const wallpaperSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("managed"), id: z.string().min(1) }),
  z.object({ kind: z.literal("path"), path: z.string().min(1) }),
]);

export type WallpaperSource = z.infer<typeof wallpaperSourceSchema>;

// The literal unions here are the authority; client palettes and the settings
// UI derive their display labels from them via type-only imports.
export const wallpaperSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * "plugin-themes": the wallpaper only paints while one of this plugin's
   * registered themes is active (marker-color detection, reliable).
   * "any-theme": paint over any theme, picking the light/dark slot from the
   * detected interface luminance (heuristic, may need re-tuning after Paseo
   * updates).
   */
  mode: z.enum(["plugin-themes", "any-theme"]).default("plugin-themes"),
  // Keep these literals in sync with the mappings in client/wallpaper/palettes.ts.
  scrim: z.enum(["subtle", "balanced", "vivid"]).default("balanced"),
  blur: z.enum(["off", "medium", "strong"]).default("strong"),
  accent: z.enum(["graphite", "magenta", "turquoise"]).default("graphite"),
  light: wallpaperSourceSchema.nullable().default(null),
  dark: wallpaperSourceSchema.nullable().default(null),
});

export const wallpaperSettings = defineSettings({
  id: "advance-wallpaper",
  scope: "host",
  version: 1,
  schema: wallpaperSettingsSchema,
});

export type WallpaperSettings = z.infer<typeof wallpaperSettingsSchema>;

export const WALLPAPER_SETTINGS_DEFAULTS: WallpaperSettings =
  wallpaperSettingsSchema.parse({});

/** The settings doc id, for RPC contracts used outside React contexts. */
export const WALLPAPER_SETTINGS_ID = "advance-wallpaper";

export const wallpaperSettingsRpc = settingsRpc(WALLPAPER_SETTINGS_ID);

/** Parse untrusted stored values; falls back to defaults when invalid. */
export function parseWallpaperSettings(values: unknown): WallpaperSettings {
  const result = wallpaperSettingsSchema.safeParse(values);
  return result.success ? result.data : WALLPAPER_SETTINGS_DEFAULTS;
}

export const wallpaperMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  addedAt: z.string(),
});

export type WallpaperMeta = z.infer<typeof wallpaperMetaSchema>;

export const wallpaperListRpc = defineRpc({
  name: "advance.wallpaper.list",
  input: z.object({}).strict(),
  output: z.object({ items: z.array(wallpaperMetaSchema) }),
});

export const wallpaperUploadRpc = defineRpc({
  name: "advance.wallpaper.upload",
  input: z.object({
    name: z.string().min(1).max(200),
    dataUrl: z.string().min(16),
  }),
  output: z.object({ wallpaper: wallpaperMetaSchema }),
});

export const wallpaperReadRpc = defineRpc({
  name: "advance.wallpaper.read",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ dataUrl: z.string() }),
});

export const wallpaperReadPathRpc = defineRpc({
  name: "advance.wallpaper.read-path",
  input: z.object({ path: z.string().min(1) }),
  output: z.object({
    dataUrl: z.string(),
    bytes: z.number().int().nonnegative(),
  }),
});

export const wallpaperDeleteRpc = defineRpc({
  name: "advance.wallpaper.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ deleted: z.boolean() }),
});
