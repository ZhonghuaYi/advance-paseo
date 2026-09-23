import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn(), watch: vi.fn() }));
vi.mock("node:fs", () => ({ promises: { readFile: mocks.readFile, stat: mocks.stat }, watch: mocks.watch }));
import { armWatchers, disarmWatchers, watcherStatus } from "./providers-watch";

const settings = { enabled: true, watchPaths: [path.resolve("settings.json")], debounceMs: 250 };
const refresh = vi.fn(async () => {});
const paseo = { providers: { refresh } } as unknown as PaseoApi;
let events: Array<(event: string, filename: string) => void>;
let closes: ReturnType<typeof vi.fn>[];
const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
beforeEach(() => {
  vi.useFakeTimers();
  events = []; closes = [];
  mocks.readFile.mockReset().mockResolvedValue(Buffer.from("old"));
  mocks.stat.mockReset().mockResolvedValue({ isFile: () => true });
  mocks.watch.mockReset().mockImplementation((_dir, _options, callback) => {
    events.push(callback);
    const close = vi.fn(); closes.push(close);
    return { on: vi.fn(), close };
  });
  refresh.mockClear();
});
afterEach(() => { disarmWatchers(); vi.useRealTimers(); });
const fire = async () => { events.at(-1)!("rename", "settings.json"); await vi.advanceTimersByTimeAsync(300); };

describe("provider watcher lifecycle", () => {
  it("serializes overlapping activations and releases every handle", async () => {
    let resolve!: (bytes: Buffer) => void;
    mocks.readFile.mockReturnValueOnce(new Promise<Buffer>(r => { resolve = r; }));
    const first = armWatchers(settings, paseo);
    await Promise.resolve();
    const second = armWatchers(settings, paseo);
    resolve(Buffer.from("old"));
    await Promise.all([first, second]);
    expect(mocks.watch).toHaveBeenCalledTimes(1);
    disarmWatchers();
    for (const close of closes) expect(close).toHaveBeenCalledOnce();
  });
  it("cannot attach after disarm during an initial read", async () => {
    let resolve!: (bytes: Buffer) => void;
    mocks.readFile.mockReturnValueOnce(new Promise<Buffer>(r => { resolve = r; }));
    const pending = armWatchers(settings, paseo);
    await Promise.resolve();
    disarmWatchers();
    resolve(Buffer.from("old"));
    await pending;
    expect(mocks.watch).not.toHaveBeenCalled();
  });
  it("refreshes on modifications, deletion and recreation, but not no-op writes", async () => {
    await armWatchers(settings, paseo);
    await fire(); expect(refresh).not.toHaveBeenCalled();
    mocks.readFile.mockResolvedValue(Buffer.from("new"));
    events[0]("rename", "settings.json");
    await fire(); expect(refresh).toHaveBeenCalledTimes(1);
    mocks.readFile.mockRejectedValue(missing);
    await fire(); expect(refresh).toHaveBeenCalledTimes(2);
    await fire(); expect(refresh).toHaveBeenCalledTimes(2);
    mocks.readFile.mockResolvedValue(Buffer.from("new"));
    await fire(); expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("reports read errors without treating them as deletion", async () => {
    await armWatchers(settings, paseo);
    mocks.readFile.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    await fire();
    expect(refresh).not.toHaveBeenCalled();
    expect((await watcherStatus()).lastError).toBe("denied");
    mocks.readFile.mockResolvedValue(Buffer.from("old"));
    await fire(); expect(refresh).not.toHaveBeenCalled();
  });
  it("invalidates pending hashes and debounce callbacks on teardown", async () => {
    await armWatchers(settings, paseo);
    let resolve!: (bytes: Buffer) => void;
    mocks.readFile.mockReturnValueOnce(new Promise<Buffer>(r => { resolve = r; }));
    await fire();
    disarmWatchers();
    resolve(Buffer.from("late"));
    await Promise.resolve(); await Promise.resolve();
    events[0]("change", "settings.json");
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("ignores a previous lifecycle's refresh result after reactivation", async () => {
    let finish!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await armWatchers(settings, paseo);
    mocks.readFile.mockResolvedValue(Buffer.from("new"));
    await fire();
    await armWatchers(settings, paseo);
    finish(); await Promise.resolve(); await Promise.resolve();
    expect((await watcherStatus()).lastRefreshAt).toBeNull();
  });
});
