// Pure data model for the live-chat overlays. Two independent pieces:
//
// - TaskSnapshot: the newest `todo` timeline item and the newest plan tool
//   call ("goal") of one agent, folded from fetched history and live stream
//   events. Both are "latest wins": a todo event replaces the whole list
//   (Claude Code TodoWrite semantics) and a later plan replaces an earlier
//   one. Fetched entries carry sequence numbers, so out-of-order fetch
//   results can never overwrite newer live data.
// - RateMeter: output tokens/sec measured over a sliding window of
//   `usage_updated` events, plus the context-window pressure from the same
//   usage payloads. After a turn completes the last measurement freezes
//   until the next turn starts.
//
// Everything here is DOM-free and clock-injected so unit tests stay pure.

import type { AgentTimelineItem, AgentUsage } from "@getpaseo/protocol/agent-types";

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskRow {
  readonly text: string;
  readonly status: TaskStatus;
}

export interface TaskSnapshot {
  readonly todos: readonly TaskRow[];
  readonly goal: string | null;
}

export const EMPTY_TASK_SNAPSHOT: TaskSnapshot = { todos: [], goal: null };

/** Normalize one todo timeline item's entry; null drops malformed rows. */
function normalizeTaskRow(raw: unknown): TaskRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const text = Reflect.get(raw, "text");
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const status = Reflect.get(raw, "status");
  const completed = Reflect.get(raw, "completed");
  if (status === "in_progress" || status === "pending" || status === "completed") {
    return { text: text.trim(), status };
  }
  return { text: text.trim(), status: completed === true ? "completed" : "pending" };
}

/** Does this timeline item carry a plan presentation ("goal")? */
function planTextOf(item: AgentTimelineItem): string | null {
  if (item.type !== "tool_call") return null;
  const detail = item.detail;
  if (typeof detail !== "object" || detail === null || detail.type !== "plan") return null;
  const text = detail.text;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fold one timeline item into a snapshot. `seq`, when provided, is the
 * daemon sequence number of the item; state tracks the highest seq it has
 * applied per field so a late history fetch never overwrites newer events.
 */
export interface TaskFoldState {
  todos: readonly TaskRow[];
  todoSeq: number;
  goal: string | null;
  goalSeq: number;
}

export function createTaskFoldState(): TaskFoldState {
  return { todos: [], todoSeq: Number.NEGATIVE_INFINITY, goal: null, goalSeq: Number.NEGATIVE_INFINITY };
}

export function foldTimelineItem(
  state: TaskFoldState,
  item: AgentTimelineItem,
  seq?: number,
): TaskFoldState {
  const itemSeq = seq ?? Number.POSITIVE_INFINITY;
  if (item.type === "todo") {
    if (itemSeq < state.todoSeq) return state;
    const rows = item.items
      .map(normalizeTaskRow)
      .filter((row): row is TaskRow => row !== null);
    return { ...state, todos: rows, todoSeq: itemSeq };
  }
  const plan = planTextOf(item);
  if (plan !== null && itemSeq >= state.goalSeq) {
    return { ...state, goal: plan, goalSeq: itemSeq };
  }
  return state;
}

/** Snapshot of the fold state as the overlay renders it. */
export function snapshotOf(state: TaskFoldState): TaskSnapshot {
  return { todos: state.todos, goal: state.goal };
}

// ---------------------------------------------------------------------------
// Rate meter
// ---------------------------------------------------------------------------

/**
 * Which usage counter drives the meter. Providers differ: some stream
 * `outputTokens` on every usage update, but Claude only reports
 * `contextWindowUsedTokens` while streaming (input+output of the active
 * request; input is fixed after message_start, so its delta ≈ output rate)
 * and delivers `outputTokens` with the turn's result. Samples never mix
 * counters: a metric switch rebaselines the window.
 */
export type RateMetric = "output" | "context";

/** Sliding window over which tokens/sec is averaged. */
export const RATE_WINDOW_MS = 12_000;
/** Two samples closer than this produce spike rates; the meter waits. */
export const RATE_MIN_SPAN_MS = 900;
/**
 * Adjacent-sample jump that reads as a context injection (a tool result
 * landing in the prompt) rather than generated output; the window restarts
 * at that sample so injections do not inflate the rate.
 */
export const RATE_REBASE_INSTANT_LIMIT = 1_200;

export interface RateSample {
  readonly atMs: number;
  readonly tokens: number;
}

export interface UsageFigures {
  /** Output tokens produced by the current (or just-finished) turn. */
  readonly outputTokens: number | null;
  /** Context window pressure in [0, 1], when the provider reports it. */
  readonly contextRatio: number | null;
}

export interface RateMeterState {
  readonly running: boolean;
  readonly metric: RateMetric | null;
  readonly samples: readonly RateSample[];
  readonly hasMeasurement: boolean;
  readonly lastProgressAt: number | null;
  /** Turn-frozen measurement shown after completion until the next turn. */
  readonly frozen: { readonly ratePerSecond: number; readonly outputTokens: number } | null;
  readonly usage: UsageFigures;
}

export function createRateMeterState(): RateMeterState {
  return {
    running: false,
    metric: null,
    samples: [],
    hasMeasurement: false,
    lastProgressAt: null,
    frozen: null,
    usage: { outputTokens: null, contextRatio: null },
  };
}

function usageFiguresOf(usage: AgentUsage | undefined): UsageFigures {
  const outputTokens =
    typeof usage?.outputTokens === "number" && Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : null;
  const used = usage?.contextWindowUsedTokens;
  const max = usage?.contextWindowMaxTokens;
  const contextRatio =
    typeof used === "number" &&
    typeof max === "number" &&
    max > 0 &&
    Number.isFinite(used) &&
    Number.isFinite(max)
      ? Math.min(1, Math.max(0, used / max))
      : null;
  return { outputTokens, contextRatio };
}

/** Usage counters as either payload shape provides them. */
interface UsageCounterSource {
  readonly outputTokens?: number | null;
  readonly contextWindowUsedTokens?: number | null;
}

/** The counter a usage payload offers for rate sampling, with its metric. */
function sampleCounterOf(usage: UsageCounterSource | undefined): {
  metric: RateMetric;
  tokens: number;
} | null {
  if (
    typeof usage?.outputTokens === "number" &&
    Number.isFinite(usage.outputTokens) &&
    usage.outputTokens >= 0
  ) {
    return { metric: "output", tokens: usage.outputTokens };
  }
  const used = usage?.contextWindowUsedTokens;
  if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
    return { metric: "context", tokens: used };
  }
  return null;
}

export function onTurnStarted(state: RateMeterState): RateMeterState {
  return { ...createRateMeterState(), running: true, usage: { ...state.usage, outputTokens: null } };
}

export function onUsageUpdated(
  state: RateMeterState,
  atMs: number,
  usage: AgentUsage,
): RateMeterState {
  const figures = usageFiguresOf(usage);
  const counter = sampleCounterOf(usage);
  if (counter === null) {
    return { ...state, usage: figures };
  }

  const previous = state.samples[state.samples.length - 1];
  let kept = state.samples.filter((sample) => atMs - sample.atMs <= RATE_WINDOW_MS);
  // Never mix counters, and treat a counter reset (new turn) or a context
  // injection (one huge hop between adjacent samples) as a fresh baseline.
  const switchesMetric = state.metric !== null && state.metric !== counter.metric;
  const resets = previous !== undefined && previous.tokens > counter.tokens;
  const jumps =
    previous !== undefined &&
    previous.tokens < counter.tokens &&
    atMs > previous.atMs &&
    ((counter.tokens - previous.tokens) / (atMs - previous.atMs)) * 1000 >
      RATE_REBASE_INSTANT_LIMIT;
  if (switchesMetric || resets || jumps) {
    kept = [];
  }

  const samples = [...kept, { atMs, tokens: counter.tokens }];
  const rebased = switchesMetric || resets || jumps ||
    (kept.length === 0 && previous !== undefined && counter.tokens !== previous.tokens);
  const hasMeasurement = (!rebased && state.hasMeasurement) ||
    (samples.length >= 2 && atMs - samples[0].atMs >= RATE_MIN_SPAN_MS);
  return {
    running: true,
    metric: counter.metric,
    samples,
    hasMeasurement,
    lastProgressAt: rebased || previous === undefined || counter.tokens > previous.tokens
      ? atMs : state.lastProgressAt,
    frozen: null,
    usage: figures,
  };
}

export function onTurnSettled(
  state: RateMeterState,
  atMs: number,
  usage?: AgentUsage,
): RateMeterState {
  const figures = usage === undefined ? state.usage : usageFiguresOf(usage);
  // The final usage payload can carry tokens the last stream sample missed;
  // record it (same metric) so the frozen rate covers the whole turn.
  let samples = state.samples;
  if (state.metric !== null) {
    const final = sampleCounterOf(usage) ?? sampleCounterOf(state.usage);
    if (final !== null && final.metric === state.metric) {
      const previous = samples[samples.length - 1];
      if (previous === undefined || previous.tokens !== final.tokens) {
        samples = [...samples, { atMs, tokens: final.tokens }];
      }
    }
  }
  // A final payload using a different counter cannot add a rate sample.
  // Freeze the latest measurement, but never revive a fully expired window.
  const last = samples[samples.length - 1];
  const finalMetric = sampleCounterOf(usage)?.metric;
  const measureAt = finalMetric !== undefined && finalMetric !== state.metric && last &&
    atMs - last.atMs < RATE_WINDOW_MS ? last.atMs : atMs;
  const rate = deriveRate({ ...state, samples, running: true }, measureAt);
  const output = figures.outputTokens;
  const frozen =
    rate !== null
      ? { ratePerSecond: rate, outputTokens: output ?? 0 }
      : state.frozen;
  return { ...state, running: false, samples, frozen, usage: figures };
}

function lastOutputOf(state: RateMeterState): number | null {
  return state.samples.length > 0 ? state.samples[state.samples.length - 1].tokens : null;
}

/** Average tokens/sec over the sliding window; null while unknown. */
export function deriveRate(state: RateMeterState, nowMs: number): number | null {
  if (!state.running) return state.frozen?.ratePerSecond ?? null;
  if (state.hasMeasurement && state.lastProgressAt !== null &&
      nowMs - state.lastProgressAt >= RATE_WINDOW_MS) return 0;
  const samples = state.samples.filter(sample => nowMs - sample.atMs <= RATE_WINDOW_MS);
  if (samples.length < 2) return state.hasMeasurement ? 0 : null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const spanMs = nowMs - first.atMs;
  const delta = last.tokens - first.tokens;
  if (spanMs < RATE_MIN_SPAN_MS || delta < 0) {
    return state.frozen !== null ? state.frozen.ratePerSecond : null;
  }
  return (delta / spanMs) * 1000;
}

/** What the meter DOM should display right now; null hides the meter. */
export interface RateMeterView {
  readonly ratePerSecond: number | null;
  readonly outputTokens: number | null;
  readonly contextRatio: number | null;
}

export function rateMeterViewOf(state: RateMeterState, nowMs: number): RateMeterView | null {
  if (state.samples.length === 0 && state.frozen === null) return null;
  const outputTokens =
    state.usage.outputTokens ??
    (state.metric === "output" ? lastOutputOf(state) : null) ??
    state.frozen?.outputTokens ??
    null;
  return {
    ratePerSecond: deriveRate(state, nowMs),
    outputTokens,
    contextRatio: state.usage.contextRatio,
  };
}
