// Directory watches survive atomic file replacement. Async work belongs to a
// lifecycle, so superseded activation cannot resurrect old watches.
import { promises as fs, watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import { providersArmRpc, providersRefreshNowRpc, providersStatusRpc,
  type ProvidersSettings, type WatchTarget } from "../shared/providers";
import { expandHomePath } from "./paths";

interface Target {
  rawPath: string;
  resolved: string;
  dir: string;
  base: string;
  exists: boolean;
  lastHash: string | null;
}
function initialState() {
  return {
    armed: false, enabled: true, debounceMs: 1500,
    targets: new Map<string, Target>(), watchers: new Map<string, FSWatcher>(),
    pending: new Set<Target>(), timer: null as ReturnType<typeof setTimeout> | null,
    paseo: null as PaseoApi | null,
    lastChangeAt: null as string | null, lastRefreshAt: null as string | null,
    lastError: null as string | null,
  };
}
type State = ReturnType<typeof initialState>;
let state = initialState();
let generation = 0;
let activationQueue: Promise<unknown> = Promise.resolve();
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const isCurrent = (current: State, version: number) => state === current && generation === version;

async function hashFile(resolved: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await fs.readFile(resolved)).digest("hex");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
function closeWatchers(current: State): void {
  for (const watcher of current.watchers.values()) watcher.close();
  current.watchers.clear();
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = null;
  current.pending.clear();
  current.armed = false;
}
function snapshots(current: State): WatchTarget[] {
  return [...current.targets.values()].map(t => ({ path: t.rawPath, resolved: t.resolved, exists: t.exists }));
}
async function triggerRefresh(current: State, version: number, paseo = current.paseo) {
  const at = new Date().toISOString();
  if (!isCurrent(current, version)) return { ok: false, at, error: "Watcher activation superseded" };
  let error: string | null = null;
  try {
    if (!paseo) throw new Error("Watcher not armed with a Paseo session");
    await paseo.providers.refresh();
  } catch (cause) {
    error = messageOf(cause);
  }
  if (isCurrent(current, version)) {
    current.lastError = error;
    if (error === null) current.lastRefreshAt = at;
  }
  return { ok: error === null, at, error };
}
async function onDebounceFire(current: State, version: number): Promise<void> {
  const candidates = [...current.pending];
  current.pending.clear();
  let changed = false;
  let readError: string | null = null;
  for (const target of candidates) {
    try {
      const hash = await hashFile(target.resolved);
      if (!isCurrent(current, version)) return;
      if (target.lastHash !== hash) changed = true;
      target.lastHash = hash;
      target.exists = hash !== null;
    } catch (error) {
      if (!isCurrent(current, version)) return;
      readError = messageOf(error);
      // Preserve the last successful hash: unreadable does not mean deleted.
    }
  }
  if (!isCurrent(current, version)) return;
  if (changed) {
    current.lastChangeAt = new Date().toISOString();
    await triggerRefresh(current, version);
  }
  if (readError !== null && isCurrent(current, version)) current.lastError = readError;
}
function onDirectoryEvent(current: State, version: number, dir: string, filename: string | null) {
  if (!isCurrent(current, version)) return;
  const candidates = [...current.targets.values()].filter(t =>
    t.dir === dir && (filename === null || filename === t.base));
  if (!candidates.length) return;
  for (const target of candidates) current.pending.add(target);
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    current.timer = null;
    if (isCurrent(current, version)) void onDebounceFire(current, version);
  }, current.debounceMs);
}
export function armWatchers(settings: ProvidersSettings, paseo: PaseoApi): Promise<{
  armed: boolean; watchPaths: WatchTarget[];
}> {
  const version = ++generation;
  closeWatchers(state);
  const task = activationQueue.then(async () => {
    if (version !== generation) return { armed: state.armed, watchPaths: snapshots(state) };
    const current = { ...initialState(), lastChangeAt: state.lastChangeAt, lastRefreshAt: state.lastRefreshAt };
    current.enabled = settings.enabled;
    current.debounceMs = settings.debounceMs;
    current.paseo = paseo;
    state = current;
    if (!settings.enabled) return { armed: false, watchPaths: [] };

    for (const rawPath of settings.watchPaths) {
      const resolved = path.resolve(expandHomePath(rawPath));
      if (current.targets.has(resolved)) continue;
      current.targets.set(resolved, { rawPath, resolved, dir: path.dirname(resolved),
        base: path.basename(resolved), exists: false, lastHash: null });
    }
    await Promise.all([...current.targets.values()].map(async target => {
      try {
        const hash = await hashFile(target.resolved);
        if (!isCurrent(current, version)) return;
        target.lastHash = hash;
        target.exists = hash !== null;
      } catch (error) {
        if (isCurrent(current, version)) current.lastError = messageOf(error);
      }
    }));
    if (!isCurrent(current, version)) return { armed: state.armed, watchPaths: snapshots(state) };
    for (const dir of new Set([...current.targets.values()].map(t => t.dir))) {
      try {
        const watcher = watch(dir, { persistent: false }, (_event, filename) =>
          onDirectoryEvent(current, version, dir, filename));
        watcher.on("error", error => {
          if (!isCurrent(current, version)) return;
          current.lastError = messageOf(error);
          watcher.close();
          current.watchers.delete(dir);
          current.armed = current.watchers.size > 0;
        });
        current.watchers.set(dir, watcher);
      } catch (error) {
        current.lastError = messageOf(error);
      }
    }
    current.armed = current.watchers.size > 0;
    return { armed: current.armed, watchPaths: snapshots(current) };
  });
  activationQueue = task.catch(() => {});
  return task;
}
export async function refreshNow(paseo: PaseoApi) {
  return triggerRefresh(state, generation, paseo);
}
export async function watcherStatus() {
  const current = state;
  const version = generation;
  await Promise.all([...current.targets.values()].map(async target => {
    try {
      const stat = await fs.stat(target.resolved);
      if (isCurrent(current, version)) target.exists = stat.isFile();
    } catch (error) {
      if (!isCurrent(current, version)) return;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") target.exists = false;
      else current.lastError = messageOf(error);
    }
  }));
  return { armed: state.armed, enabled: state.enabled, watchPaths: snapshots(state),
    debounceMs: state.debounceMs, lastChangeAt: state.lastChangeAt,
    lastRefreshAt: state.lastRefreshAt, lastError: state.lastError };
}
export function disarmWatchers(): void {
  generation += 1;
  closeWatchers(state);
  state = initialState();
}
export function registerProvidersWatcher(server: PluginServerContext): () => void {
  server.handle(providersArmRpc, (input, { paseo }) => armWatchers(input, paseo));
  server.handle(providersStatusRpc, () => watcherStatus());
  server.handle(providersRefreshNowRpc, (_input, { paseo }) => refreshNow(paseo));
  return disarmWatchers;
}
