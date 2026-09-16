// Shared contracts for the live-chat feature: a TODO card floating over the
// conversation (with the current plan/goal when one exists) plus a live
// tokens/sec meter above the composer. Everything renders client-side from
// agent timeline and usage stream events, so this feature needs no daemon
// RPCs — only this host-scoped settings document.

import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Chat-text shift in px applied while the TODO card is visible; 0 disables. */
export const CHAT_SHIFT_RANGE = { min: 0, max: 360, step: 20, default: 200 } as const;

/** Quick-pick chips next to the shift slider. */
export const CHAT_SHIFT_PRESETS: readonly { readonly id: string; readonly value: number }[] = [
  { id: "off", value: 0 },
  { id: "slight", value: 120 },
  { id: "balanced", value: 200 },
  { id: "wide", value: 280 },
];

/** Selectable caps for how many TODO rows the card renders before "+N more". */
export const MAX_TODO_CHOICES = [5, 8, 12, 20] as const;

export const liveChatSettingsSchema = z.object({
  /** Master switch for the floating TODO card. */
  todoCardEnabled: z.boolean().default(true),
  /** Show the latest plan ("goal") section at the top of the card. */
  showGoal: z.boolean().default(true),
  /** Rows rendered before the "+N more" hint. */
  maxTodoItems: z.number().int().min(3).max(20).default(8),
  /** Right padding applied to the chat column while the card is visible. */
  chatShift: z.number().int().min(CHAT_SHIFT_RANGE.min).max(CHAT_SHIFT_RANGE.max).default(CHAT_SHIFT_RANGE.default),
  /** Master switch for the tokens/sec meter. */
  rateMeterEnabled: z.boolean().default(true),
});

export const liveChatSettings = defineSettings({
  id: "advance-live-chat",
  scope: "host",
  version: 1,
  schema: liveChatSettingsSchema,
});

export type LiveChatSettings = z.infer<typeof liveChatSettingsSchema>;

export const LIVE_CHAT_SETTINGS_DEFAULTS: LiveChatSettings = liveChatSettingsSchema.parse({});

export const LIVE_CHAT_SETTINGS_ID = "advance-live-chat";

export const liveChatSettingsRpc = settingsRpc(LIVE_CHAT_SETTINGS_ID);

/** Parse untrusted stored values; falls back to defaults when invalid. */
export function parseLiveChatSettings(values: unknown): LiveChatSettings {
  const result = liveChatSettingsSchema.safeParse(values);
  return result.success ? result.data : LIVE_CHAT_SETTINGS_DEFAULTS;
}
