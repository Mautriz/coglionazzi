import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { fileUrl, type FileMetadata } from "../files";
import { authP } from "./base";
import type { CommentEntityType } from "./comments";

/** Comments have no FK on entity_id (polymorphic) — entity owners call this
 *  from their delete procedures. */
async function deleteCommentsOf(
  entityType: CommentEntityType,
  entityIds: string[],
) {
  if (entityIds.length === 0) return;
  await db
    .deleteFrom("comments")
    .where("entity_type", "=", entityType)
    .where("entity_id", "in", entityIds)
    .execute();
}

/** Kanban boards. Everything is shared between all logged-in users —
 *  it's a friends-crew app, there are no per-board permissions. */

const DEFAULT_COLUMNS = ["To do", "Doing", "Done"];

/** Next position at the end of a column (cards) or board (columns). */
async function nextCardPosition(columnId: string): Promise<number> {
  const row = await db
    .selectFrom("cards")
    .where("column_id", "=", columnId)
    .select((eb) => eb.fn.max("position").as("max"))
    .executeTakeFirst();
  return (row?.max ?? 0) + 1;
}

export const boardRouter = {
  list: authP.handler(async () => {
    return db
      .selectFrom("boards")
      .leftJoin("board_columns", "board_columns.board_id", "boards.id")
      .leftJoin("cards", "cards.column_id", "board_columns.id")
      .select(({ fn }) => [
        "boards.id",
        "boards.name",
        "boards.created_at",
        fn.count<number>("cards.id").distinct().as("cardCount"),
      ])
      .groupBy(["boards.id", "boards.name", "boards.created_at"])
      .orderBy("boards.created_at", "asc")
      .execute();
  }),

  create: authP
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .handler(async (info) => {
      const board = await db
        .insertInto("boards")
        .values({
          name: info.input.name,
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await db
        .insertInto("board_columns")
        .values(
          DEFAULT_COLUMNS.map((name, i) => ({
            board_id: board.id,
            name,
            position: i + 1,
          })),
        )
        .execute();

      return board;
    }),

  /** Full board: columns in order, each with its cards (tags, attachment
   *  files) in order. */
  get: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async (info) => {
      const board = await db
        .selectFrom("boards")
        .where("id", "=", info.input.boardId)
        .selectAll()
        .executeTakeFirst();

      if (!board) {
        throw new ORPCError("NOT_FOUND", { message: "Board not found" });
      }

      const columns = await db
        .selectFrom("board_columns")
        .where("board_id", "=", board.id)
        .selectAll()
        .orderBy("position", "asc")
        .execute();

      const cards = columns.length
        ? await db
            .selectFrom("cards")
            .where(
              "column_id",
              "in",
              columns.map((c) => c.id),
            )
            .selectAll()
            .orderBy("position", "asc")
            .execute()
        : [];

      const attachments = cards.length
        ? await db
            .selectFrom("card_attachments")
            .innerJoin("files", "files.id", "card_attachments.file_id")
            .where(
              "card_attachments.card_id",
              "in",
              cards.map((c) => c.id),
            )
            .select([
              "card_attachments.card_id",
              "files.id",
              "files.path",
              "files.metadata",
            ])
            .execute()
        : [];

      const commentCounts = cards.length
        ? await db
            .selectFrom("comments")
            .where("entity_type", "=", "card")
            .where(
              "entity_id",
              "in",
              cards.map((c) => c.id),
            )
            .select(({ fn }) => [
              "entity_id",
              fn.count<number>("id").as("count"),
            ])
            .groupBy("entity_id")
            .execute()
        : [];

      const cardsWithExtras = cards.map((card) => ({
        ...card,
        // jsonb comes back parsed; the editor wants the serialized string.
        description:
          card.description == null ? null : JSON.stringify(card.description),
        commentCount:
          commentCounts.find((c) => c.entity_id === card.id)?.count ?? 0,
        attachments: attachments
          .filter((a) => a.card_id === card.id)
          .map((a) => ({
            id: a.id,
            url: fileUrl(a.path),
            metadata: a.metadata as FileMetadata,
          })),
      }));

      return {
        ...board,
        columns: columns.map((col) => ({
          ...col,
          cards: cardsWithExtras.filter((c) => c.column_id === col.id),
        })),
      };
    }),

  addColumn: authP
    .input(
      z.object({
        boardId: z.uuid(),
        name: z.string().trim().min(1).max(80),
      }),
    )
    .handler(async (info) => {
      const row = await db
        .selectFrom("board_columns")
        .where("board_id", "=", info.input.boardId)
        .select((eb) => eb.fn.max("position").as("max"))
        .executeTakeFirst();

      return db
        .insertInto("board_columns")
        .values({
          board_id: info.input.boardId,
          name: info.input.name,
          position: (row?.max ?? 0) + 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    }),

  createCard: authP
    .input(
      z.object({
        columnId: z.uuid(),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .handler(async (info) => {
      return db
        .insertInto("cards")
        .values({
          column_id: info.input.columnId,
          title: info.input.title,
          position: await nextCardPosition(info.input.columnId),
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    }),

  updateCard: authP
    .input(
      z.object({
        cardId: z.uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        /** Serialized Lexical editor state. */
        description: z.string().nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      }),
    )
    .handler(async (info) => {
      const { cardId, ...patch } = info.input;
      if (Object.keys(patch).length === 0) return;

      await db
        .updateTable("cards")
        .set({
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.description !== undefined && {
            description: patch.description,
          }),
          ...(patch.tags !== undefined && { tags: patch.tags }),
        })
        .where("id", "=", cardId)
        .execute();
    }),

  /** Move a card into a column. `position` (float, midpoint-of-neighbors
   *  computed client-side) places it precisely; omitted = append at end. */
  moveCard: authP
    .input(
      z.object({
        cardId: z.uuid(),
        columnId: z.uuid(),
        position: z.number().finite().optional(),
      }),
    )
    .handler(async (info) => {
      await db
        .updateTable("cards")
        .set({
          column_id: info.input.columnId,
          position:
            info.input.position ??
            (await nextCardPosition(info.input.columnId)),
        })
        .where("id", "=", info.input.cardId)
        .execute();
    }),

  deleteCard: authP
    .input(z.object({ cardId: z.uuid() }))
    .handler(async (info) => {
      await deleteCommentsOf("card", [info.input.cardId]);
      await db.deleteFrom("cards").where("id", "=", info.input.cardId).execute();
    }),

  deleteBoard: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async (info) => {
      // Comments have no FK to cards — collect the board's card ids and
      // clean theirs up before the cascade wipes columns/cards/attachments.
      const cards = await db
        .selectFrom("cards")
        .innerJoin("board_columns", "board_columns.id", "cards.column_id")
        .where("board_columns.board_id", "=", info.input.boardId)
        .select("cards.id")
        .execute();

      await deleteCommentsOf(
        "card",
        cards.map((c) => c.id),
      );

      await db
        .deleteFrom("boards")
        .where("id", "=", info.input.boardId)
        .execute();
    }),

  addAttachment: authP
    .input(z.object({ cardId: z.uuid(), fileId: z.uuid() }))
    .handler(async (info) => {
      await db
        .insertInto("card_attachments")
        .values({ card_id: info.input.cardId, file_id: info.input.fileId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }),

  removeAttachment: authP
    .input(z.object({ cardId: z.uuid(), fileId: z.uuid() }))
    .handler(async (info) => {
      await db
        .deleteFrom("card_attachments")
        .where("card_id", "=", info.input.cardId)
        .where("file_id", "=", info.input.fileId)
        .execute();
    }),
};
