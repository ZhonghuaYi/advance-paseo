// Mode detection for the wallpaper engine. Two strategies share one sampling
// pass over the rendered surfaces:
//
// - Marker mode ("plugin-themes"): scores computed background colors against
//   the marker colors of this plugin's registered theme palettes. An
//   unrelated Paseo theme matches nothing, so the wallpaper turns off.
// - Luminance mode ("any-theme"): area-weighted average of opaque background
//   luminance decides light vs dark, so the wallpaper follows whichever
//   built-in or third-party theme is active. Heuristic by nature; re-tune
//   the threshold if Paseo's stock palettes change radically.
//
// The classification functions are pure so they can be unit-tested; the DOM
// sampling lives in the engine.

import {
  ALL_DARK_MARKERS,
  ALL_LIGHT_MARKERS,
  matchesMarker,
  type Rgba,
} from "./palettes";

/** One observed opaque background, weighted by its share of the viewport. */
export interface SurfaceSample {
  readonly color: Rgba;
  readonly weight: number;
}

export type WallpaperMode = "light" | "dark";

/** WCAG relative luminance of an sRGB color, alpha ignored. */
export function relativeLuminance(color: Rgba): number {
  const channel = (raw: number): number => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const red = channel(color[0]);
  const green = channel(color[1]);
  const blue = channel(color[2]);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Marker strategy: which plugin palette family is currently painted. */
export function classifyMarkerMode(
  samples: readonly SurfaceSample[],
): WallpaperMode | null {
  let lightScore = 0;
  let darkScore = 0;
  for (const sample of samples) {
    if (matchesMarker(sample.color, ALL_LIGHT_MARKERS)) lightScore += sample.weight;
    if (matchesMarker(sample.color, ALL_DARK_MARKERS)) darkScore += sample.weight;
  }
  if (lightScore === 0 && darkScore === 0) return null;
  return darkScore > lightScore ? "dark" : "light";
}

/** Opaque-enough backgrounds only; translucent panels would skew the average. */
const LUMINANCE_ALPHA_FLOOR = 0.9;

/** Luminance strategy: average interface brightness decides the mode. */
export function classifyLuminanceMode(
  samples: readonly SurfaceSample[],
): WallpaperMode | null {
  let totalWeight = 0;
  let weighted = 0;
  for (const sample of samples) {
    if (sample.color[3] < LUMINANCE_ALPHA_FLOOR) continue;
    totalWeight += sample.weight;
    weighted += relativeLuminance(sample.color) * sample.weight;
  }
  if (totalWeight === 0) return null;
  return weighted / totalWeight >= 0.5 ? "light" : "dark";
}
