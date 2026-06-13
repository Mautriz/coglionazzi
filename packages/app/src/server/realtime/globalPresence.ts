import { createKeyedPresence } from "./presenceRegistry";
import { publisher, type PresenceViewer } from "./publisher";

/** In-memory app-wide presence: who is connected right now, across every page.
 *  Deduped by user (multiple tabs = one entry). The per-board sibling is
 *  presence.ts; the per-session one is gamePublisher.ts. It's the shared keyed
 *  registry under a single constant key (there's only one app-wide roster). */
const KEY = "app";
const registry = createKeyedPresence<PresenceViewer>((_key, viewers) =>
  publisher.publish("globalPresence", { viewers }),
);

export function globalPresenceSnapshot(): PresenceViewer[] {
  return registry.snapshot(KEY);
}

/** Register a connected user; returns a leave fn (call on socket close). */
export function joinGlobalPresence(viewer: PresenceViewer): () => void {
  return registry.join(KEY, viewer);
}
