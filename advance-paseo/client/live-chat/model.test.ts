// Unit tests for the pure live-chat model: todo/goal folding from timeline
// items and the sliding-window tokens/sec meter.

import { describe, expect, it } from "vitest";
import type { AgentTimelineItem, AgentUsage } from "@getpaseo/protocol/agent-types";
import {
  createRateMeterState,
  createTaskFoldState,
  foldTimelineItem,
  onTurnSettled,
  onTurnStarted,
  onUsageUpdated,
  rateMeterViewOf,
  snapshotOf,
} from "./model";

function todoItem(items: unknown[]): AgentTimelineItem {
  return { type: "todo", items } as AgentTimelineItem;
}

function planItem(text: string): AgentTimelineItem {
  return {
    type: "tool_call",
    callId: `call-${text.length}`,
    name: "ExitPlanMode",
    status: "completed",
    error: null,
    detail: { type: "plan", text },
  } as AgentTimelineItem;
}

function shellItem(): AgentTimelineItem {
  return {
    type: "tool_call",
    callId: "call-shell",
    name: "Bash",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "ls" },
  } as AgentTimelineItem;
}

describe("foldTimelineItem", () => {
  it("normalizes todo rows from explicit statuses", () => {
    const state = foldTimelineItem(
      createTaskFoldState(),
      todoItem([
        { text: "write code", status: "in_progress" },
        { text: "ship it", status: "pending" },
        { text: "plan", completed: true },
      ]),
    );
    expect(snapshotOf(state).todos).toEqual([
      { text: "write code", status: "in_progress" },
      { text: "ship it", status: "pending" },
      { text: "plan", status: "completed" },
    ]);
  });

  it("falls back to the completed flag when status is absent", () => {
    const state = foldTimelineItem(
      createTaskFoldState(),
      todoItem([{ text: "done thing", completed: true }]),
    );
    expect(snapshotOf(state).todos).toEqual([{ text: "done thing", status: "completed" }]);
  });

  it("drops malformed rows but keeps valid ones", () => {
    const state = foldTimelineItem(
      createTaskFoldState(),
      todoItem([{ text: "   " }, { completed: true }, { text: "real" }]),
    );
    expect(snapshotOf(state).todos).toEqual([{ text: "real", status: "pending" }]);
  });

  it("replaces the whole list on a newer todo item", () => {
    let state = foldTimelineItem(createTaskFoldState(), todoItem([{ text: "a" }]));
    state = foldTimelineItem(state, todoItem([{ text: "b" }, { text: "c" }]));
    expect(snapshotOf(state).todos.map((row) => row.text)).toEqual(["b", "c"]);
  });

  it("keeps live-applied todos over a lower-seq history fold", () => {
    let state = foldTimelineItem(createTaskFoldState(), todoItem([{ text: "live" }]));
    state = foldTimelineItem(state, todoItem([{ text: "stale" }]), 5);
    expect(snapshotOf(state).todos.map((row) => row.text)).toEqual(["live"]);
  });

  it("captures the latest plan as the goal", () => {
    let state = foldTimelineItem(createTaskFoldState(), shellItem());
    expect(snapshotOf(state).goal).toBeNull();
    state = foldTimelineItem(state, planItem("First plan"));
    state = foldTimelineItem(state, shellItem());
    state = foldTimelineItem(state, planItem("Second plan"));
    expect(snapshotOf(state).goal).toBe("Second plan");
  });

  it("does not replace a newer goal with an older-seq plan", () => {
    let state = foldTimelineItem(createTaskFoldState(), planItem("newer"), 10);
    state = foldTimelineItem(state, planItem("older"), 3);
    expect(snapshotOf(state).goal).toBe("newer");
  });
});

describe("idle rate readings", () => {
  it("decays without new events and reaches zero after twelve seconds", () => {
    let state = onTurnStarted(createRateMeterState());
    state = onUsageUpdated(state, 0, { outputTokens: 0 });
    state = onUsageUpdated(state, 1000, { outputTokens: 100 });
    expect(rateMeterViewOf(state, 1000)?.ratePerSecond).toBe(100);
    expect(rateMeterViewOf(state, 5000)?.ratePerSecond).toBe(20);
    expect(rateMeterViewOf(state, 13000)?.ratePerSecond).toBe(0);
    expect(rateMeterViewOf(state, 21000)?.ratePerSecond).toBe(0);
    state = onUsageUpdated(state, 22000, { outputTokens: 150 });
    expect(rateMeterViewOf(state, 22000)?.ratePerSecond).toBeNull();
  });
  it("does not confuse repeated counters with fresh output", () => {
    let state = onTurnStarted(createRateMeterState());
    state = onUsageUpdated(state, 0, { outputTokens: 0 });
    state = onUsageUpdated(state, 1000, { outputTokens: 100 });
    state = onUsageUpdated(state, 12000, { outputTokens: 100 });
    expect(rateMeterViewOf(state, 13000)?.ratePerSecond).toBe(0);
    state = onTurnSettled(state, 14000);
    expect(rateMeterViewOf(state, 100000)?.ratePerSecond).toBe(0);
    expect(rateMeterViewOf(onTurnStarted(state), 100000)).toBeNull();
  });
});

describe("rate meter", () => {
  const outputUsage = (outputTokens: number, over?: Partial<AgentUsage>): AgentUsage => ({
    outputTokens,
    ...over,
  });
  const contextUsage = (
    contextWindowUsedTokens: number,
    contextWindowMaxTokens?: number,
  ): AgentUsage => ({
    contextWindowUsedTokens,
    ...(contextWindowMaxTokens === undefined ? {} : { contextWindowMaxTokens }),
  });

  it("hides until a sample or frozen reading exists", () => {
    expect(rateMeterViewOf(createRateMeterState(), 10_000)).toBeNull();
  });

  it("measures tokens/sec across the sample window (output metric)", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, outputUsage(0));
    meter = onUsageUpdated(meter, 3_000, outputUsage(120));
    const view = rateMeterViewOf(meter, 3_000);
    expect(view?.ratePerSecond).toBeCloseTo(60, 1);
    expect(view?.outputTokens).toBe(120);
  });

  it("drives the rate from context-window deltas when output is absent", () => {
    // Claude streams only contextWindowUsedTokens (input fixed at start).
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, contextUsage(50_000, 200_000));
    meter = onUsageUpdated(meter, 5_000, contextUsage(50_400, 200_000));
    const view = rateMeterViewOf(meter, 5_000);
    expect(view?.ratePerSecond).toBeCloseTo(100, 1);
    // The context counter is not an output count; nothing to show for it.
    expect(view?.outputTokens).toBeNull();
    expect(view?.contextRatio).toBeCloseTo(0.252, 2);
  });

  it("rebases on a context injection instead of inflating the rate", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, contextUsage(50_000));
    meter = onUsageUpdated(meter, 3_000, contextUsage(50_300));
    // A 20k tool result lands between two samples 200 ms apart.
    meter = onUsageUpdated(meter, 3_200, contextUsage(70_320));
    meter = onUsageUpdated(meter, 5_200, contextUsage(70_520));
    const view = rateMeterViewOf(meter, 5_200);
    expect(view?.ratePerSecond).toBeCloseTo((70_520 - 70_320) / 2, 1);
  });

  it("rebases when switching between usage metrics", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, contextUsage(50_000));
    meter = onUsageUpdated(meter, 3_000, contextUsage(50_300));
    meter = onUsageUpdated(meter, 5_000, outputUsage(40));
    const view = rateMeterViewOf(meter, 5_000);
    expect(view?.ratePerSecond).toBeNull();
    expect(view?.outputTokens).toBe(40);
  });

  it("waits for a minimum span before reporting a rate", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, outputUsage(0));
    meter = onUsageUpdated(meter, 1_400, outputUsage(500));
    const view = rateMeterViewOf(meter, 1_400);
    expect(view?.ratePerSecond).toBeNull();
    expect(view?.outputTokens).toBe(500);
  });

  it("drops samples older than the window", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 0, outputUsage(0));
    meter = onUsageUpdated(meter, 5_000, outputUsage(1_000));
    // At 15s the first sample (15s old) has fallen out of the 12s window,
    // but the 5s sample is still in.
    meter = onUsageUpdated(meter, 15_000, outputUsage(2_200));
    const view = rateMeterViewOf(meter, 15_000);
    expect(view?.ratePerSecond).toBeCloseTo((2_200 - 1_000) / 10, 1);
  });

  it("rebases when the token counter resets", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, outputUsage(900));
    meter = onUsageUpdated(meter, 2_000, outputUsage(1_000));
    meter = onUsageUpdated(meter, 3_000, outputUsage(50));
    const view = rateMeterViewOf(meter, 3_000);
    expect(view?.outputTokens).toBe(50);
    expect(view?.ratePerSecond).toBeNull();
  });

  it("freezes the final rate when the turn settles", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, outputUsage(0));
    meter = onUsageUpdated(meter, 5_000, outputUsage(400));
    meter = onTurnSettled(meter, 5_200, outputUsage(410));
    const view = rateMeterViewOf(meter, 30_000);
    expect(view?.ratePerSecond).toBeCloseTo(410 / 4.2, 1);
    expect(view?.outputTokens).toBe(410);
    expect(meter.running).toBe(false);
  });

  it("shows the result's real output count after a context-driven turn", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(meter, 1_000, contextUsage(50_000));
    meter = onUsageUpdated(meter, 5_000, contextUsage(50_400));
    // The turn result carries the accurate per-turn output count; its output
    // counter is a different metric, so the frozen rate stays on the context
    // samples while the display count switches to the real one.
    meter = onTurnSettled(meter, 5_100, outputUsage(390, { inputTokens: 49_610 }));
    const view = rateMeterViewOf(meter, 30_000);
    expect(view?.ratePerSecond).toBeCloseTo(100, 1);
    expect(view?.outputTokens).toBe(390);
  });

  it("reports context pressure when provided", () => {
    let meter = onTurnStarted(createRateMeterState());
    meter = onUsageUpdated(
      meter,
      1_000,
      outputUsage(20, { contextWindowUsedTokens: 50_000, contextWindowMaxTokens: 200_000 }),
    );
    expect(rateMeterViewOf(meter, 1_000)?.contextRatio).toBeCloseTo(0.25, 3);
  });
});
