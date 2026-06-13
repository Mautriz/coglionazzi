/** Shared in-memory presence primitive. Three registries are built on it —
 *  per-board (presence.ts), per-session lobby (gamePublisher.ts) and app-wide
 *  (globalPresence.ts) — they differ only in how they broadcast the new roster.
 *  Single instance (see publisher.ts): these registries live in this process. */

/** Dedupe a roster to one entry per user (a user with several tabs counts
 *  once) — the "counting" every presence snapshot shares. */
export function dedupeByUser<T extends { userId: string }>(
  viewers: Iterable<T>,
): T[] {
  const byUser = new Map<string, T>();
  for (const v of viewers) byUser.set(v.userId, v);
  return [...byUser.values()];
}

/** A keyed presence registry: viewers grouped under a key (boardId, sessionId,
 *  …), deduped by user. Each active subscription joins under a unique token and
 *  gets a leave fn (call it on socket close / unsubscribe). `broadcast(key,
 *  roster)` fires after every join/leave so the owner can publish the new
 *  roster on its own channel/shape. An app-wide registry is just this with one
 *  constant key. */
export function createKeyedPresence<T extends { userId: string }>(
  broadcast: (key: string, roster: T[]) => void,
) {
  const groups = new Map<string, Map<symbol, T>>();

  const snapshot = (key: string): T[] => {
    const group = groups.get(key);
    return group ? dedupeByUser(group.values()) : [];
  };

  const join = (key: string, viewer: T): (() => void) => {
    let group = groups.get(key);
    if (!group) {
      group = new Map();
      groups.set(key, group);
    }
    const token = Symbol("presence");
    group.set(token, viewer);
    broadcast(key, snapshot(key));

    let left = false;
    return () => {
      if (left) return;
      left = true;
      const current = groups.get(key);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) groups.delete(key);
      broadcast(key, snapshot(key));
    };
  };

  return { snapshot, join };
}
