// Daemon-side wallpaper storage. Imported wallpapers are re-encoded on the
// client (downscaled WebP/JPEG), uploaded here as data URLs, and persisted
// under `<paseo home>/advance-paseo/wallpapers/` with an index.json sidecar.
// Path-referenced wallpapers are read from their original location on demand.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import { expandHomePath, paseoHome } from "./paths";
import {
  wallpaperDeleteRpc,
  wallpaperListRpc,
  wallpaperReadPathRpc,
  wallpaperReadRpc,
  wallpaperUploadRpc,
  type WallpaperMeta,
} from "../shared/wallpaper";

/** Largest decoded upload accepted from the client-side encoder. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Largest file served from a raw path reference (originals are not re-encoded). */
const MAX_PATH_BYTES = 24 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
};

function dataRoot(): string {
  return path.join(paseoHome(), "advance-paseo", "wallpapers");
}

interface StoreIndex {
  version: 1;
  items: Record<string, WallpaperMeta>;
}

async function readIndex(dir: string): Promise<StoreIndex> {
  try {
    const raw = await fs.readFile(path.join(dir, "index.json"), "utf8");
    const parsed = JSON.parse(raw) as StoreIndex;
    if (parsed.version === 1 && parsed.items && typeof parsed.items === "object") {
      return parsed;
    }
  } catch {
    // Missing or corrupt index: start fresh rather than fail every RPC.
  }
  return { version: 1, items: {} };
}

/** Serialize the complete transaction, including its read, per data directory. */
const indexQueues = new Map<string, Promise<unknown>>();

function transact<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const task = (indexQueues.get(dir) ?? Promise.resolve()).then(run);
  const tail = task.catch(() => {});
  indexQueues.set(dir, tail);
  void tail.then(() => {
    if (indexQueues.get(dir) === tail) indexQueues.delete(dir);
  });
  return task;
}

async function writeIndex(dir: string, index: StoreIndex): Promise<void> {
  const tmp = path.join(dir, `index.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
    await fs.rename(tmp, path.join(dir, "index.json"));
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 image data URL");
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  return { mime, bytes };
}

export async function listWallpapers(): Promise<{ items: WallpaperMeta[] }> {
  const dir = dataRoot();
  const index = await readIndex(dir);
  const items = Object.values(index.items).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return { items };
}

export async function uploadWallpaper(input: RpcInput<typeof wallpaperUploadRpc>): Promise<{
  wallpaper: WallpaperMeta;
}> {
  const { mime, bytes } = parseDataUrl(input.dataUrl);
  const extension = EXTENSION_BY_MIME[mime];
  if (!extension) {
    throw new Error(`Unsupported wallpaper image type: ${mime || "(none)"}`);
  }
  if (bytes.byteLength === 0) throw new Error("Wallpaper image is empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Wallpaper exceeds the ${MAX_UPLOAD_BYTES >> 20} MiB limit`);
  }

  const dir = dataRoot();
  await fs.mkdir(dir, { recursive: true });

  const id = randomUUID();
  const file = path.join(dir, `${id}${extension}`);
  await fs.writeFile(file, bytes);

  const meta: WallpaperMeta = {
    id,
    name: input.name.trim() || `Wallpaper ${id.slice(0, 8)}`,
    mime,
    bytes: bytes.byteLength,
    addedAt: new Date().toISOString(),
  };

  try {
    await transact(dir, async () => {
      const index = await readIndex(dir);
      index.items[id] = meta;
      await writeIndex(dir, index);
    });
  } catch (error) {
    await fs.rm(file, { force: true }).catch(() => {});
    throw error;
  }
  console.log(
    `[advance-paseo] stored wallpaper "${meta.name}" (${(meta.bytes / 1024).toFixed(0)} KiB, ${mime})`,
  );
  return { wallpaper: meta };
}

export async function readWallpaper(input: RpcInput<typeof wallpaperReadRpc>): Promise<{
  dataUrl: string;
}> {
  const dir = dataRoot();
  const index = await readIndex(dir);
  const meta = index.items[input.id];
  if (!meta) throw new Error(`Unknown wallpaper: ${input.id}`);

  const extension = EXTENSION_BY_MIME[meta.mime];
  const bytes = await fs.readFile(path.join(dir, `${input.id}${extension}`));
  return { dataUrl: `data:${meta.mime};base64,${bytes.toString("base64")}` };
}

export async function readWallpaperPath(input: RpcInput<typeof wallpaperReadPathRpc>): Promise<{
  dataUrl: string;
  bytes: number;
}> {
  const resolved = path.resolve(expandHomePath(input.path));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);
  if (stat.size > MAX_PATH_BYTES) {
    throw new Error(`Wallpaper file exceeds the ${MAX_PATH_BYTES >> 20} MiB limit`);
  }
  const mime = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image extension: ${path.extname(resolved) || "(none)"}`);

  const bytes = await fs.readFile(resolved);
  return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, bytes: bytes.byteLength };
}

export async function deleteWallpaper(input: RpcInput<typeof wallpaperDeleteRpc>): Promise<{
  deleted: boolean;
}> {
  const dir = dataRoot();
  return transact(dir, async () => {
    const index = await readIndex(dir);
    const meta = index.items[input.id];
    if (!meta) return { deleted: false };

    delete index.items[input.id];
    await writeIndex(dir, index);

    const extension = EXTENSION_BY_MIME[meta.mime];
    await fs.rm(path.join(dir, `${input.id}${extension}`), { force: true });
    console.log(`[advance-paseo] deleted wallpaper "${meta.name}"`);
    return { deleted: true };
  });
}

/** Register every wallpaper RPC handler; returns the feature cleanup. */
export function registerWallpaperStore(server: PluginServerContext): () => void {
  server.handle(wallpaperListRpc, () => listWallpapers());
  server.handle(wallpaperUploadRpc, (input) => uploadWallpaper(input));
  server.handle(wallpaperReadRpc, (input) => readWallpaper(input));
  server.handle(wallpaperReadPathRpc, (input) => readWallpaperPath(input));
  server.handle(wallpaperDeleteRpc, (input) => deleteWallpaper(input));
  return () => {};
}
