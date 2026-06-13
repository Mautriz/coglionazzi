import { EventPublisher } from "@orpc/server";

/** A user present in a game lobby (deduped by id — multiple tabs count once). */
export interface GamePresenceUser {
  userId: string;
  name: string | null;
}

/** What `game.sessions.subscribe` streams. High-frequency `votes` carry live
 *  tallies + the (possibly shortened) deadline; the low-frequency `state`
 *  signal tells the client to refetch `game.sessions.get` (matchup opened /
 *  resolved / game finished); `presence` carries the live lobby roster. */
export type GameEvent =
  | { type: "presence"; players: GamePresenceUser[] }
  | { type: "state" }
  | {
      type: "votes";
      matchupId: string;
      leftVotes: number;
      rightVotes: number;
      votedCount: number;
      rosterSize: number;
      deadline: string;
    }
  // A matchup just resolved — clients reveal the winner (zoom) for a beat
  // before the next matchup opens (a following `state` event).
  | {
      type: "resolved";
      matchupId: string;
      winnerCardId: string | null;
      leftVotes: number;
      rightVotes: number;
    };

/** Session-keyed fan-out (like `chatPublisher`): a game event only wakes ITS
 *  session's subscribers, not every connected player. */
export const gamePublisher = new EventPublisher<Record<string, GameEvent>>();

export function publishGame(sessionId: string, event: GameEvent) {
  gamePublisher.publish(sessionId, event);
}

// --- lobby presence (in-memory, single instance — see publisher.ts) --------
const lobbies = new Map<string, Map<symbol, GamePresenceUser>>();

function snapshot(sessionId: string): GamePresenceUser[] {
  const lobby = lobbies.get(sessionId);
  if (!lobby) return [];
  const byUser = new Map<string, GamePresenceUser>();
  for (const u of lobby.values()) byUser.set(u.userId, u);
  return [...byUser.values()];
}

export function gamePresenceSnapshot(sessionId: string): GamePresenceUser[] {
  return snapshot(sessionId);
}

/** Register a present user and broadcast the new roster. Returns a leave fn
 *  (call it when the subscription ends — socket close / unsubscribe). */
export function joinGamePresence(
  sessionId: string,
  user: GamePresenceUser,
): () => void {
  let lobby = lobbies.get(sessionId);
  if (!lobby) {
    lobby = new Map();
    lobbies.set(sessionId, lobby);
  }
  const token = Symbol("game-presence");
  lobby.set(token, user);
  publishGame(sessionId, { type: "presence", players: snapshot(sessionId) });

  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = lobbies.get(sessionId);
    if (!current) return;
    current.delete(token);
    if (current.size === 0) lobbies.delete(sessionId);
    publishGame(sessionId, { type: "presence", players: snapshot(sessionId) });
  };
}
