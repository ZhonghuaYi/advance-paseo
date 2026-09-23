import type { PaseoApi, PaseoAgentUpdate } from "@getpaseo/client";
import { afterEach, expect, it, vi } from "vitest";
import { watchAgentDirectory } from "./agent-directory";

afterEach(() => vi.useRealTimers());
const page = (ids: string[], nextCursor: string | null = null) => ({
  entries: ids.map(id => ({ agent: { id } })), pageInfo: { nextCursor, hasMore: nextCursor !== null },
});
it("merges all pages with updates received during loading and unsubscribes", async () => {
  let update!: (value: PaseoAgentUpdate) => void;
  let finish!: (value: ReturnType<typeof page>) => void;
  const stop = vi.fn();
  const list = vi.fn().mockResolvedValueOnce(page(["first"], "next"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const paseo = { agents: { list, subscribe: (fn: typeof update) => { update = fn; return stop; } } } as unknown as PaseoApi;
  const publish = vi.fn(); const directory = watchAgentDirectory(paseo, publish);
  await Promise.resolve(); await Promise.resolve();
  update({ kind: "remove", agentId: "first" });
  update({ kind: "upsert", agent: { id: "live" } } as PaseoAgentUpdate);
  finish(page(["second"])); await Promise.resolve(); await Promise.resolve();
  expect(list.mock.calls[1][0].page.cursor).toBe("next");
  expect([...publish.mock.calls[0][0]].sort()).toEqual(["live", "second"]);
  directory.dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("ignores results after disposal and retries failed reads without leaking timers", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof page>) => void;
  const list = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stop = vi.fn(); const publish = vi.fn();
  const directory = watchAgentDirectory({ agents: { list, subscribe: () => stop } } as unknown as PaseoApi, publish);
  await vi.advanceTimersByTimeAsync(5000);
  expect(publish).toHaveBeenCalledWith(null);
  directory.dispose(); finish(page(["late"]));
  await Promise.resolve(); await Promise.resolve();
  expect(publish).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
