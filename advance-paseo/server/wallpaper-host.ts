import { promises as fs } from "node:fs";
import path from "node:path";
import { paseoHome } from "./paths";

/** Mirrors Paseo's daemon identity lookup without creating or changing it. */
export async function readWallpaperHostId(): Promise<string | null> {
  const override = process.env.PASEO_SERVER_ID?.trim();
  if (override) return override;
  try {
    const id = (await fs.readFile(path.join(paseoHome(), "server-id"), "utf8")).trim();
    return id || null;
  } catch {
    return null;
  }
}
