import type { PaseoApi } from "@getpaseo/client";

/** Own only a local SDK listener; the app owns its directory stream demand. */
export function watchAgentDirectory(
  paseo: PaseoApi,
  publish: (agents: ReadonlySet<string> | null) => void,
) {
  let disposed = false;
  let loading = false;
  let known: Set<string> | null = null;
  let lastFetch = Number.NEGATIVE_INFINITY;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const changes = new Map<string, boolean>();
  const stop = paseo.agents.subscribe(update => {
    if (disposed) return;
    const id = update.kind === "upsert" ? update.agent.id : update.agentId;
    const present = update.kind === "upsert";
    if (loading) changes.set(id, present);
    if (known) {
      if (present) known.add(id); else known.delete(id);
      publish(new Set(known));
    }
  });

  const refresh = () => {
    if (disposed || loading) return;
    const wait = 5000 - (Date.now() - lastFetch);
    if (wait > 0) {
      if (retry === null) retry = setTimeout(() => { retry = null; refresh(); }, wait);
      return;
    }
    loading = true;
    lastFetch = Date.now();
    changes.clear();
    void (async () => {
      try {
        const ids = new Set<string>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
          if (disposed) return;
          for (const entry of page.entries) ids.add(entry.agent.id);
          cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
          if (page.pageInfo.hasMore && (!cursor || cursors.has(cursor))) throw new Error("Invalid agent directory cursor");
          if (cursor) cursors.add(cursor);
        } while (cursor);
        for (const [id, present] of changes) {
          if (present) ids.add(id); else ids.delete(id);
        }
        known = ids;
        loading = false;
        publish(new Set(ids));
      } catch (error) {
        if (disposed) return;
        known = null;
        loading = false;
        publish(null);
        console.error("[advance-paseo] agent directory read failed", error);
        refresh();
      } finally {
        loading = false;
      }
    })();
  };
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      stop();
    },
  };
}
