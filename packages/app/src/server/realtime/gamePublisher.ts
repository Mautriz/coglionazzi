import { EventPublisher } from "@orpc/server";
import { createKeyedPresence } from "./presenceRegistry";
import type { PresenceViewer } from "./publisher";

/** A user present in a game lobby (deduped by id — multiple tabs count once).
 *  Same shape as a board viewer. */
export type GamePresenceUser = PresenceViewer;

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
//  Built on the shared keyed registry; broadcasts the roster as a game event.
const lobbyPresence = createKeyedPresence<GamePresenceUser>(
  (sessionId, players) =>
    publishGame(sessionId, { type: "presence", players }),
);

export function gamePresenceSnapshot(sessionId: string): GamePresenceUser[] {
  return lobbyPresence.snapshot(sessionId);
}

/** Register a present user; returns a leave fn (call on socket close). */
export function joinGamePresence(
  sessionId: string,
  user: GamePresenceUser,
): () => void {
  return lobbyPresence.join(sessionId, user);
}
