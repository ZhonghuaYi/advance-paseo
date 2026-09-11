// Single source of truth for the wallpaper feature's palettes and visual
// mappings. index.client.ts registers the theme contributions, the CSS
// builder derives every scrim, border, and blur value from here, and the mode
// detector derives its marker colors from here. Editing a color in one place
// updates the theme, the visuals, and detection.
//
// Two palette pairs ship: the Miku Future palettes carried over from
// paseo-miku-theme, and a neutral pair (warm cream / deep indigo) suited to
// arbitrary wallpapers. Marker hues are deliberately distinctive so unrelated
// Paseo themes do not accidentally enable the wallpaper in plugin-themes
// mode.

import type { PluginThemeContribution } from "@getpaseo/plugin";
import type { WallpaperSettings } from "../../shared/wallpaper";

export type Rgb = readonly [red: number, green: number, blue: number];

export const MIKU_LIGHT_COLORS = {
  background: "#F7FCFB",
  foreground: "#203638",
  raised: "#FFFFFF",
  control: "#E6F5F3",
  border: "#B9DCD8",
  // Deeper than the iconic turquoise so light button labels meet WCAG AA.
  accent: "#087F79",
  mutedForeground: "#5A7375",
  ring: "#2B8F8A",
} as const;

export const MIKU_DARK_COLORS = {
  background: "#10181B",
  foreground: "#EAF7F6",
  raised: "#172326",
  control: "#203236",
  border: "#38555A",
  // The canonical brighter Miku turquoise has strong contrast on dark canvas.
  accent: "#39C5BB",
  mutedForeground: "#9AB6B8",
  ring: "#65DED2",
} as const;

export const CREAM_LIGHT_COLORS = {
  background: "#FAF6EF",
  foreground: "#2C2A26",
  raised: "#FFFFFF",
  control: "#F0E9DC",
  border: "#D8CDB8",
  accent: "#8A6D1D",
  mutedForeground: "#6E675C",
  ring: "#B0A37F",
} as const;

export const INDIGO_DARK_COLORS = {
  background: "#12131C",
  foreground: "#E9EAF4",
  raised: "#1A1C29",
  control: "#242738",
  border: "#3A3F58",
  accent: "#8B93F8",
  mutedForeground: "#9BA0B8",
  ring: "#5A6188",
} as const;

export interface PalettePair {
  readonly light: PluginThemeContribution;
  readonly dark: PluginThemeContribution;
  readonly lightMarkers: readonly Rgb[];
  readonly darkMarkers: readonly Rgb[];
}

function theme(
  id: string,
  name: string,
  appearance: "light" | "dark",
  colors: PluginThemeContribution["colors"],
): PluginThemeContribution {
  return { id, name, appearance, colors };
}

export const MIKU_PAIR: PalettePair = {
  light: theme("advance-miku-light", "Miku Future Light", "light", MIKU_LIGHT_COLORS),
  dark: theme("advance-miku-dark", "Miku Future Dark", "dark", MIKU_DARK_COLORS),
  lightMarkers: [
    hexToRgb(MIKU_LIGHT_COLORS.background),
    hexToRgb(MIKU_LIGHT_COLORS.control),
  ],
  darkMarkers: [
    hexToRgb(MIKU_DARK_COLORS.background),
    hexToRgb(MIKU_DARK_COLORS.raised),
    hexToRgb(MIKU_DARK_COLORS.control),
  ],
};

export const NEUTRAL_PAIR: PalettePair = {
  light: theme("advance-cream", "Advance Cream", "light", CREAM_LIGHT_COLORS),
  dark: theme("advance-indigo", "Advance Indigo", "dark", INDIGO_DARK_COLORS),
  lightMarkers: [
    hexToRgb(CREAM_LIGHT_COLORS.background),
    hexToRgb(CREAM_LIGHT_COLORS.control),
  ],
  darkMarkers: [
    hexToRgb(INDIGO_DARK_COLORS.background),
    hexToRgb(INDIGO_DARK_COLORS.raised),
    hexToRgb(INDIGO_DARK_COLORS.control),
  ],
};

/** Every palette pair registered as official color themes. */
export const PALETTE_PAIRS: readonly PalettePair[] = [MIKU_PAIR, NEUTRAL_PAIR];

/** Marker unions across every registered pair, for mode detection. */
export const ALL_LIGHT_MARKERS: readonly Rgb[] = PALETTE_PAIRS.flatMap(
  (pair) => pair.lightMarkers,
);
export const ALL_DARK_MARKERS: readonly Rgb[] = PALETTE_PAIRS.flatMap(
  (pair) => pair.darkMarkers,
);

// Message-card accent families. "graphite" is the neutral default that suits
// arbitrary wallpapers; the Miku families are carried over for continuity.
export type AccentChoice = WallpaperSettings["accent"];

export const ACCENT_HEXES = {
  graphite: { light: "#334155", dark: "#94A3B8" },
  magenta: { light: "#E12885", dark: "#FF7EBE" },
  turquoise: { light: "#087F79", dark: "#65DED2" },
} as const satisfies Record<AccentChoice, { light: string; dark: string }>;

export const ACCENT_CHOICES: readonly { label: string; value: AccentChoice }[] = [
  { label: "Graphite", value: "graphite" },
  { label: "Miku magenta", value: "magenta" },
  { label: "Miku turquoise", value: "turquoise" },
];

/** Dark user-message card tint, matched to the chosen accent family. */
export const CARD_TINTS = {
  graphite: [21, 24, 33],
  magenta: [29, 23, 48],
  turquoise: [13, 29, 28],
} as const satisfies Record<AccentChoice, readonly [number, number, number]>;

// Neutral scrim/veil tints painted over arbitrary wallpapers. These replace
// the palette-tinted scrims the Miku plugin derived from its own theme
// colors; near-white and near-black stay readable behind any image.
export const WALLPAPER_TINTS = {
  lightBackground: hexToRgb("#FAFAFC"),
  darkBackground: hexToRgb("#101218"),
  lightRing: hexToRgb("#C6C1B2"),
  darkRing: hexToRgb("#4A5068"),
  darkTabs: hexToRgb("#131521"),
} as const;

// Wallpaper visibility presets scale the scrim alphas painted over the
// image. "subtle" hides more of the image behind heavier scrims; "vivid"
// lets more of it through. Readability-critical message cards and code
// blocks are intentionally not scaled.
export type ScrimLevel = WallpaperSettings["scrim"];

export const SCRIM_LEVELS: readonly { label: string; value: ScrimLevel }[] = [
  { label: "Subtle", value: "subtle" },
  { label: "Balanced", value: "balanced" },
  { label: "Vivid", value: "vivid" },
];

const SCRIM_SCALES: Record<ScrimLevel, number> = {
  subtle: 1.25,
  balanced: 1,
  vivid: 0.78,
};

// Frosted-glass blur presets in CSS pixels.
export type BlurLevel = WallpaperSettings["blur"];

export const BLUR_LEVELS: readonly { label: string; value: BlurLevel }[] = [
  { label: "Off", value: "off" },
  { label: "Medium", value: "medium" },
  { label: "Strong", value: "strong" },
];

const BLUR_PIXELS: Record<BlurLevel, { sidebar: number; sheet: number; code: number }> = {
  off: { sidebar: 0, sheet: 0, code: 0 },
  medium: { sidebar: 14, sheet: 12, code: 10 },
  strong: { sidebar: 22, sheet: 18, code: 16 },
};

/** Shared visual options for the wallpaper enhancement and the settings UI. */
export interface WallpaperStyleOptions {
  readonly scrim: ScrimLevel;
  readonly accent: AccentChoice;
  readonly blur: BlurLevel;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function rgbaString(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${roundAlpha(alpha)})`;
}

function roundAlpha(alpha: number): number {
  return Math.min(1, Math.max(0.05, Math.round(alpha * 100) / 100));
}

export function scaledAlpha(base: number, scrim: ScrimLevel): number {
  return roundAlpha(base * SCRIM_SCALES[scrim]);
}

export function blurPixels(level: BlurLevel): {
  sidebar: number;
  sheet: number;
  code: number;
} {
  return BLUR_PIXELS[level];
}

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export function parseRgba(value: string): Rgba | null {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  );
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? 1 : Number(match[4]),
  ];
}

export type { Rgba };

export function matchesMarker(color: Rgba, markers: readonly Rgb[]): boolean {
  if (color[3] < 0.1) return false;
  return markers.some(
    ([red, green, blue]) =>
      Math.abs(color[0] - red) <= 2 &&
      Math.abs(color[1] - green) <= 2 &&
      Math.abs(color[2] - blue) <= 2,
  );
}
