// Providers auto-refresh watcher. Paseo's daemon caches the provider catalog
// (models, modes) and only re-discovers it on an explicit
// `paseo.providers.refresh()`. This module watches provider CLI config files
// — Claude Code's settings by default — and triggers that refresh whenever a
// watched file's content actually changes.
//
// Watch strategy: each watched file's PARENT directory gets one fs.watch
// handle, filtered by file name, so temp-file-plus-rename atomic saves fire
// the same as in-place writes. Content is sha256-compared against the last
// seen hash so no-op rewrites never trigger a refresh. A trailing debounce
// collapses editor save bursts.

import { promises as fs, watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import {
  providersArmRpc,
  providersRefreshNowRpc,
  providersStatusRpc,
  type ProvidersSettings,
  type WatchTarget,
} from "../shared/providers";
import { expandHomePath } from "./paths";

interface WatchTargetState {
  rawPath: string;
  resolved: string;
  dir: string;
  base: string;
  exists: boolean;
  /** sha256 hex of the last seen content; null while the file is missing. */
  lastHash: string | null;
}

interface WatcherState {
  armed: boolean;
  enabled: boolean;
  debounceMs: number;
  targets: Map<string, WatchTargetState>;
  watchers: Map<string, FSWatcher>;
  pending: Set<WatchTargetState>;
  timer: ReturnType<typeof setTimeout> | null;
  paseo: PaseoApi | null;
  lastChangeAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

function initialState(): WatcherState {
  return {
    armed: false,
    enabled: true,
    debounceMs: 1500,
    targets: new Map(),
    watchers: new Map(),
    pending: new Set(),
    timer: null,
    paseo: null,
    lastChangeAt: null,
    lastRefreshAt: null,
    lastError: null,
  };
}

let state: WatcherState = initialState();

async function hashFile(resolved: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(resolved);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

function closeWatchers(): void {
  for (const watcher of state.watchers.values()) watcher.close();
  state.watchers.clear();
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.pending.clear();
}

function targetSnapshots(): WatchTarget[] {
  return [...state.targets.values()].map((target) => ({
    path: target.rawPath,
    resolved: target.resolved,
    exists: target.exists,
  }));
}

async function refreshExistsFlags(): Promise<void> {
  await Promise.all(
    [...state.targets.values()].map(async (target) => {
      try {
        const stat = await fs.stat(target.resolved);
        target.exists = stat.isFile();
      } catch {
        target.exists = false;
      }
    }),
  );
}

function onDirectoryEvent(dir: string, filename: string | null): void {
  const candidates = [...state.targets.values()].filter(
    (target) => target.dir === dir && (filename === null || filename === target.base),
  );
  if (candidates.length === 0) return;
  for (const candidate of candidates) state.pending.add(candidate);
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void onDebounceFire();
  }, state.debounceMs);
}

async function onDebounceFire(): Promise<void> {
  const candidates = [...state.pending];
  state.pending.clear();

  let changed = false;
  for (const target of candidates) {
    const hash = await hashFile(target.resolved);
    if (hash === null) {
      // The file vanished; remember that so a later re-creation counts as a
      // change instead of silently becoming the new baseline.
      target.lastHash = null;
      target.exists = false;
      continue;
    }
    target.exists = true;
    // null -> hash means the file appeared; string -> hash means it changed.
    if (target.lastHash !== hash) {
      target.lastHash = hash;
      changed = true;
    }
  }

  if (!changed) return;
  state.lastChangeAt = new Date().toISOString();
  console.log("[advance-paseo] provider config change detected; refreshing providers");
  await triggerRefresh();
}

async function triggerRefresh(): Promise<void> {
  const paseo = state.paseo;
  if (!paseo) {
    state.lastError = "Watcher not armed with a Paseo session";
    return;
  }
  try {
    await paseo.providers.refresh();
    state.lastRefreshAt = new Date().toISOString();
    state.lastError = null;
    console.log("[advance-paseo] providers refreshed");
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error("[advance-paseo] providers refresh failed:", state.lastError);
  }
}

/** Re-arm (or disarm) the watcher with the given settings. */
export async function armWatchers(
  settings: ProvidersSettings,
  paseo: PaseoApi,
): Promise<{ armed: boolean; watchPaths: WatchTarget[] }> {
  state.paseo = paseo;
  closeWatchers();
  state.targets.clear();
  state.enabled = settings.enabled;
  state.debounceMs = settings.debounceMs;

  if (!settings.enabled) {
    state.armed = false;
    return { armed: false, watchPaths: targetSnapshots() };
  }

  // Deduplicate by resolved path while preserving configuration order.
  const seen = new Set<string>();
  for (const rawPath of settings.watchPaths) {
    const resolved = path.resolve(expandHomePath(rawPath));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    state.targets.set(resolved, {
      rawPath,
      resolved,
      dir: path.dirname(resolved),
      base: path.basename(resolved),
      exists: false,
      lastHash: null,
    });
  }

  // Baseline hashes before attaching watchers so arming never triggers a
  // refresh by itself.
  await Promise.all(
    [...state.targets.values()].map(async (target) => {
      target.lastHash = await hashFile(target.resolved);
      target.exists = target.lastHash !== null;
    }),
  );

  for (const dir of new Set([...state.targets.values()].map((target) => target.dir))) {
    try {
      const watcher = watch(dir, { persistent: false }, (event, filename) => {
        // fs.watch event names vary by platform and are not trusted here;
        // any event for a watched file name is enough to schedule a check.
        onDirectoryEvent(dir, filename);
      });
      watcher.on("error", (error) => {
        state.lastError = error instanceof Error ? error.message : String(error);
        console.error(`[advance-paseo] watcher error on ${dir}:`, state.lastError);
      });
      state.watchers.set(dir, watcher);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(`[advance-paseo] cannot watch ${dir}:`, state.lastError);
    }
  }

  // Armed only when at least one directory is actually being watched;
  // otherwise the status row explains through exists flags and lastError.
  state.armed = state.targets.size > 0 && state.watchers.size > 0;
  console.log(
    `[advance-paseo] provider watcher ${state.armed ? "armed" : "disarmed"}: ` +
      [...state.targets.values()].map((target) => target.resolved).join(", "),
  );
  return { armed: state.armed, watchPaths: targetSnapshots() };
}

/** Manual refresh used by the settings screen button. */
export async function refreshNow(paseo: PaseoApi): Promise<{
  ok: boolean;
  at: string;
  error: string | null;
}> {
  // Route through the shared trigger so status fields stay consistent, but
  // with the caller-provided session (works even while disarmed).
  const saved = state.paseo;
  state.paseo = paseo;
  await triggerRefresh();
  state.paseo = saved ?? paseo;
  return {
    ok: state.lastError === null,
    at: state.lastRefreshAt ?? new Date().toISOString(),
    error: state.lastError,
  };
}

export async function watcherStatus(): Promise<{
  armed: boolean;
  enabled: boolean;
  watchPaths: WatchTarget[];
  debounceMs: number;
  lastChangeAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}> {
  await refreshExistsFlags();
  return {
    armed: state.armed,
    enabled: state.enabled,
    watchPaths: targetSnapshots(),
    debounceMs: state.debounceMs,
    lastChangeAt: state.lastChangeAt,
    lastRefreshAt: state.lastRefreshAt,
    lastError: state.lastError,
  };
}

export function disarmWatchers(): void {
  closeWatchers();
  state = initialState();
}

/** Register the provider watcher RPC handlers; returns the feature cleanup. */
export function registerProvidersWatcher(server: PluginServerContext): () => void {
  server.handle(providersArmRpc, (input, { paseo }) => armWatchers(input, paseo));
  server.handle(providersStatusRpc, () => watcherStatus());
  server.handle(providersRefreshNowRpc, (_input, { paseo }) => refreshNow(paseo));
  return () => disarmWatchers();
}
