import { publisher, type PresenceViewer } from "./publisher";

/** In-memory app-wide presence: who is connected right now, across every page.
 *  Each active socket subscription registers under a unique token; the roster
 *  is deduped by user (multiple tabs = one entry). Lives only in this process —
 *  see the single-instance note in publisher.ts. The per-board sibling is
 *  presence.ts; the per-session one is gamePublisher.ts. */
const connections = new Map<symbol, PresenceViewer>();

function snapshot(): PresenceViewer[] {
  const byUser = new Map<string, PresenceViewer>();
  for (const viewer of connections.values()) byUser.set(viewer.userId, viewer);
  return [...byUser.values()];
}

export function globalPresenceSnapshot(): PresenceViewer[] {
  return snapshot();
}

/** Register a connected user and broadcast the new roster. Returns a leave
 *  function that deregisters and re-broadcasts — call it when the subscription
 *  ends (socket close / unsubscribe). */
export function joinGlobalPresence(viewer: PresenceViewer): () => void {
  const token = Symbol("global-presence");
  connections.set(token, viewer);
  publisher.publish("globalPresence", { viewers: snapshot() });

  let left = false;
  return () => {
    if (left) return;
    left = true;
    connections.delete(token);
    publisher.publish("globalPresence", { viewers: snapshot() });
  };
}
