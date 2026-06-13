import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { authP } from "./base";
import {
  attachCardExtras,
  deleteCommentsOf,
  nextCardPosition,
} from "./boards";
import { assertCardAccess, assertTeamMember } from "./teamAccess";

/** Per-team card archive. Cards land here (instead of being destroyed) when a
 *  user archives them, or when their column/board is deleted — see
 *  `board.archiveCard` / `deleteColumn` / `deleteBoard`. `team_id` is
 *  denormalized onto the card so the archive survives the board/column going
 *  away (`column_id` then null). Access is gated on the card's team. */
export const archiveRouter = {
  /** A team's archived cards, fully nested (assignees, relations, comment
   *  count, attachments), newest-archived first. */
  list: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      const cards = await db
        .selectFrom("cards")
        .where("team_id", "=", info.input.teamId)
        .where("archived_at", "is not", null)
        .selectAll()
        .orderBy("archived_at", "desc")
        .execute();
      // The archive shows relations among archived cards too, so don't filter
      // archived counterparts here (unlike a live board).
      return attachCardExtras(cards, { liveRelationsOnly: false });
    }),

  /** Columns the caller can restore an archived card into — every column of
   *  every board in the team, labelled by board, for the destination picker
   *  shown when a card's original board is gone. */
  restoreTargets: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      return db
        .selectFrom("board_columns")
        .innerJoin("boards", "boards.id", "board_columns.board_id")
        .where("boards.team_id", "=", info.input.teamId)
        .select([
          "board_columns.id as columnId",
          "board_columns.name as columnName",
          "boards.id as boardId",
          "boards.name as boardName",
        ])
        .orderBy("boards.name", "asc")
        .orderBy("board_columns.position", "asc")
        .execute();
    }),

  /** Un-archive a card back onto a board. Restores into its original column
   *  when that still exists (`column_id` kept); otherwise the caller must pass
   *  a `destinationColumnId` in the same team. */
  restore: authP
    .input(
      z.object({
        cardId: z.uuid(),
        destinationColumnId: z.uuid().optional(),
      }),
    )
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      const card = await db
        .selectFrom("cards")
        .where("id", "=", info.input.cardId)
        .select(["column_id", "team_id", "archived_at"])
        .executeTakeFirstOrThrow();
      if (!card.archived_at) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Card is not archived.",
        });
      }

      const targetColumnId = info.input.destinationColumnId ?? card.column_id;
      if (!targetColumnId) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "The original board is gone — pick a column to restore into.",
        });
      }

      // The target column must belong to the card's own team (a user can be
      // in several teams; don't let a card cross into another team's board).
      const target = await db
        .selectFrom("board_columns")
        .innerJoin("boards", "boards.id", "board_columns.board_id")
        .where("board_columns.id", "=", targetColumnId)
        .select("boards.team_id")
        .executeTakeFirst();
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Column not found." });
      }
      if (target.team_id !== card.team_id) {
        throw new ORPCError("FORBIDDEN", {
          message: "Cannot restore a card into another team's board.",
        });
      }

      await db
        .updateTable("cards")
        .set({
          archived_at: null,
          archived_by: null,
          archived_origin: null,
          column_id: targetColumnId,
          position: await nextCardPosition(targetColumnId),
        })
        .where("id", "=", info.input.cardId)
        .execute();
    }),

  /** Permanently delete an archived card (and its polymorphic comments). Only
   *  archived cards can be purged this way. */
  purge: authP
    .input(z.object({ cardId: z.uuid() }))
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      const card = await db
        .selectFrom("cards")
        .where("id", "=", info.input.cardId)
        .select("archived_at")
        .executeTakeFirstOrThrow();
      if (!card.archived_at) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only archived cards can be permanently deleted.",
        });
      }
      await deleteCommentsOf("card", [info.input.cardId]);
      await db
        .deleteFrom("cards")
        .where("id", "=", info.input.cardId)
        .execute();
    }),
};
