import { EventPublisher } from "@orpc/server";
import { db } from "../db";

/** A board viewer, for presence. One entry per distinct user (a user with
 *  several tabs counts once). */
export interface PresenceViewer {
  userId: string;
  name: string | null;
}

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
