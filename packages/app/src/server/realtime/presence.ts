import { createKeyedPresence } from "./presenceRegistry";
import { publisher, type PresenceViewer } from "./publisher";

/** In-memory board presence (one entry per user; multiple tabs = one viewer).
 *  Built on the shared keyed registry — broadcasts the new roster on the
 *  `presence` channel keyed by board. */
const registry = createKeyedPresence<PresenceViewer>((boardId, viewers) =>
  publisher.publish("presence", { boardId, viewers }),
);

export function presenceSnapshot(boardId: string): PresenceViewer[] {
  return registry.snapshot(boardId);
}

/** Register a viewer on a board; returns a leave fn (call on socket close). */
export function joinPresence(
  boardId: string,
  viewer: PresenceViewer,
): () => void {
  return registry.join(boardId, viewer);
}
