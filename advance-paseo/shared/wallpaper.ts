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

// Numeric styling ranges shared by the schema, the slider UI, and the CSS
// builder. Kept here so every layer enforces the same bounds.
export const SCRIM_RANGE = { min: 50, max: 150, step: 5, default: 100 } as const;
export const BLUR_RANGE = { min: 0, max: 40, step: 1, default: 22 } as const;

// Values persisted by the original three-step presets, migrated on read so
// stored documents keep working after the numeric upgrade.
const LEGACY_SCRIM_LEVELS: Record<string, number> = {
  subtle: 125,
  balanced: 100,
  vivid: 78,
};
const LEGACY_BLUR_LEVELS: Record<string, number> = {
  off: 0,
  medium: 14,
  strong: 22,
};

export type ScrimPresetId = keyof typeof LEGACY_SCRIM_LEVELS;
export type BlurPresetId = keyof typeof LEGACY_BLUR_LEVELS;

/**
 * Quick-pick presets shown as chips next to the sliders. Values mirror the
 * legacy levels exactly so a migrated document highlights the same chip that
 * originally produced it; the slider still allows any value in between.
 */
export const SCRIM_PRESETS: readonly { readonly id: ScrimPresetId; readonly value: number }[] = [
  { id: "subtle", value: LEGACY_SCRIM_LEVELS.subtle },
  { id: "balanced", value: LEGACY_SCRIM_LEVELS.balanced },
  { id: "vivid", value: LEGACY_SCRIM_LEVELS.vivid },
];
export const BLUR_PRESETS: readonly { readonly id: BlurPresetId; readonly value: number }[] = [
  { id: "off", value: LEGACY_BLUR_LEVELS.off },
  { id: "medium", value: LEGACY_BLUR_LEVELS.medium },
  { id: "strong", value: LEGACY_BLUR_LEVELS.strong },
];

const scrimField = z.preprocess(
  (value) =>
    typeof value === "string" && value in LEGACY_SCRIM_LEVELS
      ? LEGACY_SCRIM_LEVELS[value]
      : value,
  z.number().int().min(SCRIM_RANGE.min).max(SCRIM_RANGE.max).default(SCRIM_RANGE.default),
);

const blurField = z.preprocess(
  (value) =>
    typeof value === "string" && value in LEGACY_BLUR_LEVELS
      ? LEGACY_BLUR_LEVELS[value]
      : value,
  z.number().int().min(BLUR_RANGE.min).max(BLUR_RANGE.max).default(BLUR_RANGE.default),
);

const modeField = z.preprocess(
  (value) =>
    value === "plugin-themes" ? "system" : value === "any-theme" ? "all" : value,
  z.enum(["system", "all"]).default("system"),
);

// The literal unions here are the authority; client palettes and the settings
// UI derive their display labels from them via type-only imports.
export const wallpaperSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * "system": paint only while a built-in Paseo theme is active — the
   * wallpaper turns off when one of this plugin's own themes is selected.
   * "all": paint over every theme. Both pick the light/dark slot from the
   * detected interface luminance.
   */
  mode: modeField,
  /** Scrim strength in percent; 100 matches the original "balanced" preset. */
  scrim: scrimField,
  /** Frosted-glass blur in px applied to the largest surface; 0 disables. */
  blur: blurField,
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
