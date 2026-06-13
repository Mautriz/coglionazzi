import { publisher, type PresenceViewer } from "./publisher";

/** In-memory board presence. Each active subscription registers under a unique
 *  token; the viewer list is deduped by user (multiple tabs = one viewer).
 *  Lives only in this process — see the single-instance note in publisher.ts. */
const rooms = new Map<string, Map<symbol, PresenceViewer>>();

function snapshot(boardId: string): PresenceViewer[] {
  const room = rooms.get(boardId);
  if (!room) return [];
  const byUser = new Map<string, PresenceViewer>();
  for (const viewer of room.values()) byUser.set(viewer.userId, viewer);
  return [...byUser.values()];
}

export function presenceSnapshot(boardId: string): PresenceViewer[] {
  return snapshot(boardId);
}

/** Register a viewer on a board and broadcast the new roster. Returns a leave
 *  function that deregisters and re-broadcasts — call it when the subscription
 *  ends (socket close / unsubscribe). */
export function joinPresence(
  boardId: string,
  viewer: PresenceViewer,
): () => void {
  let room = rooms.get(boardId);
  if (!room) {
    room = new Map();
    rooms.set(boardId, room);
  }
  const token = Symbol("presence");
  room.set(token, viewer);
  publisher.publish("presence", { boardId, viewers: snapshot(boardId) });

  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = rooms.get(boardId);
    if (!current) return;
    current.delete(token);
    if (current.size === 0) rooms.delete(boardId);
    publisher.publish("presence", { boardId, viewers: snapshot(boardId) });
  };
}
