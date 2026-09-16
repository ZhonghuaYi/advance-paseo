// Resolves the active wallpaper settings into image data URLs. Used by the
// client entry wiring (daemon-backed reader built from client.rpc) and by the
// settings screen (reader built from useRpc handles), so failures degrade to
// "no wallpaper" instead of breaking either path. A failed configured slot is
// reported through `failed` so the entry wiring can retry the read instead of
// silently leaving the engine imageless until the settings screen is opened.

import {
  wallpaperReadPathRpc,
  wallpaperReadRpc,
  type WallpaperSettings,
  type WallpaperSource,
} from "../../shared/wallpaper";
import type { WallpaperImages } from "./engine";

export interface WallpaperReader {
  readManaged(id: string): Promise<string>;
  readPath(path: string): Promise<string>;
}

async function readSource(
  reader: WallpaperReader,
  source: WallpaperSource | null,
): Promise<string | null> {
  if (source === null) return null;
  try {
    if (source.kind === "managed") return await reader.readManaged(source.id);
    return await reader.readPath(source.path);
  } catch (error) {
    console.error("[advance-paseo] wallpaper load failed", error);
    return null;
  }
}

export interface WallpaperResolution {
  readonly images: WallpaperImages;
  /** True when a configured slot failed to load (unset slots never count). */
  readonly failed: boolean;
}

export async function resolveWallpaperImagesWith(
  reader: WallpaperReader,
  settings: WallpaperSettings,
): Promise<WallpaperResolution> {
  const [light, dark] = await Promise.all([
    readSource(reader, settings.light),
    readSource(reader, settings.dark),
  ]);
  return {
    images: { light, dark },
    failed:
      (settings.light !== null && light === null) ||
      (settings.dark !== null && dark === null),
  };
}
