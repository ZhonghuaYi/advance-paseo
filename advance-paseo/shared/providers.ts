// Shared contracts for the providers auto-refresh feature. The daemon keeps
// its provider catalog (models, modes) in memory and only re-discovers it on
// an explicit refresh; this feature watches provider CLI config files (for
// example Claude Code's settings.json) and triggers that refresh whenever a
// file changes.

import { defineRpc, defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_WATCH_PATHS = ["~/.claude/settings.json", "~/.claude.json"] as const;

export const providersSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  watchPaths: z.array(z.string().min(1)).default([...DEFAULT_WATCH_PATHS]),
  debounceMs: z.number().int().min(250).max(10_000).default(1500),
});

export const providersSettings = defineSettings({
  id: "advance-providers",
  scope: "host",
  version: 1,
  schema: providersSettingsSchema,
});

export type ProvidersSettings = z.infer<typeof providersSettingsSchema>;

export const PROVIDERS_SETTINGS_DEFAULTS: ProvidersSettings =
  providersSettingsSchema.parse({});

export const PROVIDERS_SETTINGS_ID = "advance-providers";

export const providersSettingsRpc = settingsRpc(PROVIDERS_SETTINGS_ID);

export function parseProvidersSettings(values: unknown): ProvidersSettings {
  const result = providersSettingsSchema.safeParse(values);
  return result.success ? result.data : PROVIDERS_SETTINGS_DEFAULTS;
}

export const watchTargetSchema = z.object({
  /** The configured path, `~` unexpanded. */
  path: z.string(),
  /** Absolute path after expanding `~`. */
  resolved: z.string(),
  exists: z.boolean(),
});

export type WatchTarget = z.infer<typeof watchTargetSchema>;

export const providersStatusRpc = defineRpc({
  name: "advance.providers.status",
  input: z.object({}).strict(),
  output: z.object({
    armed: z.boolean(),
    enabled: z.boolean(),
    watchPaths: z.array(watchTargetSchema),
    debounceMs: z.number().int(),
    lastChangeAt: z.string().nullable(),
    lastRefreshAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
});

export const providersArmRpc = defineRpc({
  name: "advance.providers.arm",
  input: providersSettingsSchema,
  output: z.object({
    armed: z.boolean(),
    watchPaths: z.array(watchTargetSchema),
  }),
});

export const providersRefreshNowRpc = defineRpc({
  name: "advance.providers.refresh-now",
  input: z.object({}).strict(),
  output: z.object({
    ok: z.boolean(),
    at: z.string(),
    error: z.string().nullable(),
  }),
});
