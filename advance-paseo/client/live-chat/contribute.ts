// Live-chat feature contribution: the data layer between the engine's DOM
// bindings and the daemon. For every agent the engine binds (its chat is
// visible), this subscribes to the agent's timeline stream and folds it into
// the newest todo list + plan ("goal") while measuring output tokens/sec
// from usage events. History is fetched once per binding so an already-long
// conversation shows its current todo state immediately.

import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { AgentStreamEvent } from "@getpaseo/protocol/agent-types";
import {
  liveChatSettingsRpc,
  parseLiveChatSettings,
} from "../../shared/live-chat";
import {
  applyLiveChatState,
  engineStateOf,
  installLiveChatEngine,
  pushRateMeter,
  pushTaskSnapshot,
  removeLiveChatEngine,
  setLiveDataAdapter,
} from "./engine";
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

/** Newest timeline entries to fold for the initial snapshot. */
const HISTORY_LIMIT = 80;
/** While a turn runs, refresh the meter so the sliding window decays. */
const METER_TICK_MS = 1000;

export function contributeLiveChat(client: PluginClientContext): () => void {
  // The overlays are a progressive-enhancement layer over host DOM; a
  // failure here must never take down the rest of the entry (settings screen,
  // wallpaper integration), so every stage is guarded.
  try {
    installLiveChatEngine();
  } catch (error) {
    console.error("[advance-paseo] live chat engine install failed", error);
    return () => {};
  }

  void client
    .rpc(liveChatSettingsRpc.read, {})
    .then((read) => {
      if (read.status !== "ready") return;
      applyLiveChatState(engineStateOf(parseLiveChatSettings(read.values)));
    })
    .catch((error) => {
      console.error("[advance-paseo] live chat settings read failed", error);
    });

  try {
    setLiveDataAdapter({ subscribeAgent: subscribeAgentFactory(client) });
  } catch (error) {
    console.error("[advance-paseo] live chat adapter setup failed", error);
  }

  return () => removeLiveChatEngine();
}

function subscribeAgentFactory(client: PluginClientContext) {
  return (agentId: string): (() => void) => {
    let fold = createTaskFoldState();
    let meter = createRateMeterState();
    let tick: number | null = null;
    let stopped = false;

    const pushSnapshot = (): void => {
      pushTaskSnapshot(agentId, snapshotOf(fold));
    };

    const pushMeter = (): void => {
      pushRateMeter(agentId, rateMeterViewOf(meter, Date.now()));
    };

    /** The meter only needs a ticker while a turn is running. */
    const manageTick = (): void => {
      if (typeof window === "undefined") return;
      if (meter.running && tick === null) {
        tick = window.setInterval(pushMeter, METER_TICK_MS);
      } else if (!meter.running && tick !== null) {
        window.clearInterval(tick);
        tick = null;
      }
    };

    const applyEvent = (event: AgentStreamEvent): void => {
      switch (event.type) {
        case "timeline":
          fold = foldTimelineItem(fold, event.item);
          pushSnapshot();
          break;
        case "turn_started":
          meter = onTurnStarted(meter);
          pushMeter();
          break;
        case "usage_updated":
          meter = onUsageUpdated(meter, Date.now(), event.usage);
          pushMeter();
          break;
        case "turn_completed":
          meter = onTurnSettled(meter, Date.now(), event.usage);
          pushMeter();
          break;
        case "turn_failed":
        case "turn_canceled":
          meter = onTurnSettled(meter, Date.now(), undefined);
          pushMeter();
          break;
        default:
          break;
      }
      manageTick();
    };

    const ref = client.paseo.agents.ref(agentId);

    const fetchHistory = (): void => {
      void ref.timeline
        .refetch({ direction: "tail", limit: HISTORY_LIMIT })
        .then((payload) => {
          if (stopped) return;
          for (const entry of payload.entries) {
            fold = foldTimelineItem(fold, entry.item, entry.seqEnd);
          }
          pushSnapshot();
        })
        .catch((error) => {
          console.error("[advance-paseo] live chat history fetch failed", error);
        });
    };
    fetchHistory();

    const subscription = ref.timeline.subscribe((update) => {
      if (stopped) return;
      if (update.event.type === "replacement") {
        // The timeline was rewritten (fork/rewind); start over from the new
        // history before applying further live events.
        fold = createTaskFoldState();
        pushSnapshot();
        fetchHistory();
        return;
      }
      applyEvent(update.event);
    });
    void subscription.ready.catch((error) => {
      console.error("[advance-paseo] live chat stream subscription failed", error);
    });

    return () => {
      stopped = true;
      if (tick !== null && typeof window !== "undefined") window.clearInterval(tick);
      tick = null;
      subscription();
      pushTaskSnapshot(agentId, null);
      pushRateMeter(agentId, null);
    };
  };
}
