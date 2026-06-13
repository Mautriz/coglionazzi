import { EventPublisher } from "@orpc/server";
import { db } from "../db";

/** A board viewer, for presence. One entry per distinct user (a user with
 *  several tabs counts once). */
export interface PresenceViewer {
  userId: string;
  name: string | null;
}

/** A fully-shaped chat message as the client consumes it (body serialized to a
 *  string for the editor; reactions aggregated). `reactedByMe` is per-viewer,
 *  so realtime reaction changes are streamed as raw deltas (see ChatEvent) and
 *  each client resolves `reactedByMe` itself. */
export interface ChatMessagePayload {
  id: string;
  roomId: string;
  body: string;
  author: string | null;
  createdBy: string | null;
  createdAt: string;
  editedAt: string | null;
  reactions: { emoji: string; count: number; reactedByMe: boolean }[];
}

/** What `chat.subscribe` streams. Append/patch/remove against the local list;
 *  reaction deltas carry the actor so each client recomputes `reactedByMe`. */
export type ChatEvent =
  | { type: "created"; message: ChatMessagePayload }
  | { type: "updated"; messageId: string; body: string; editedAt: string }
  | { type: "deleted"; messageId: string }
  | {
      type: "reaction";
      messageId: string;
      emoji: string;
      userId: string;
      added: boolean;
    };

/** Realtime channels. Payloads carry the entity id so per-entity subscription
 *  procedures can filter the single shared channel down to their target. */
interface RealtimeEvents {
  /** A board's columns/cards changed — subscribers refetch `board.get`. */
  board: { boardId: string };
  /** A comment thread changed — subscribers refetch `comment.list`. */
  comment: { entityType: string; entityId: string };
  /** A board's set of current viewers changed. */
  presence: { boardId: string; viewers: PresenceViewer[] };
  /** A team's membership or board set changed (board added/removed, member
   *  added/removed, rename, delete) — workspace subscribers refetch their
   *  `team.list`/`board.list`. `affectedUserIds` carries members whose OWN
   *  membership changed (add/remove/leave/delete) so they're notified even
   *  when the event leaves/left them outside the team. */
  team: { teamId: string; affectedUserIds?: string[] };
}

/** Chat fan-out is keyed by `roomId` (NOT a single shared channel) so a
 *  message only wakes that room's subscribers. Chat is high-frequency — unlike
 *  the low-frequency board/comment/team channels above, we don't want every
 *  connected chat consumer woken for every message in every room. */
export const chatPublisher = new EventPublisher<Record<string, ChatEvent>>();

/** In-process pub/sub for realtime fan-out. Single app instance (see CLAUDE.md
 *  Realtime): one Node process broadcasts to every connected socket. To scale
 *  horizontally later, back this with Postgres LISTEN/NOTIFY — only this file
 *  changes. */
export const publisher = new EventPublisher<RealtimeEvents>();

export function publishBoardChanged(boardId: string) {
  publisher.publish("board", { boardId });
}

export function publishCommentChanged(entityType: string, entityId: string) {
  publisher.publish("comment", { entityType, entityId });
}

/** Announce a team's membership/board-set changed. Pass `affectedUserIds` for
 *  members whose own membership changed (so removed members are still told). */
export function publishTeamChanged(teamId: string, affectedUserIds?: string[]) {
  publisher.publish("team", { teamId, affectedUserIds });
}

/** Stream a chat change to the room's subscribers (only). */
export function publishChat(roomId: string, event: ChatEvent) {
  chatPublisher.publish(roomId, event);
}

/** Resolve a column's board and announce the board changed. */
export async function publishBoardOfColumn(columnId: string) {
  const row = await db
    .selectFrom("board_columns")
    .where("id", "=", columnId)
    .select("board_id")
    .executeTakeFirst();
  if (row) publishBoardChanged(row.board_id);
}

/** Resolve a (live) card's board and announce the board changed. Archived
 *  cards have no column, so nothing is published — they aren't on any board. */
export async function publishBoardOfCard(cardId: string) {
  const row = await db
    .selectFrom("cards")
    .innerJoin("board_columns", "board_columns.id", "cards.column_id")
    .where("cards.id", "=", cardId)
    .select("board_columns.board_id")
    .executeTakeFirst();
  if (row?.board_id) publishBoardChanged(row.board_id);
}
