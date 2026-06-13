import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { fileUrl, type FileMetadata } from "../files";
import { extractLexicalText } from "../lexicalText";
import { authP } from "./base";
import type { CommentEntityType } from "./comments";
import {
  assertBoardAccess,
  assertCardAccess,
  assertColumnAccess,
  assertTeamMember,
  myTeamIds,
} from "./teamAccess";

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

/** Kanban boards, scoped to teams: a user only sees/touches boards of teams
 *  they belong to (membership checks live in `./teamAccess`). */

const DEFAULT_COLUMNS = ["To do", "Doing", "Done"];

/** Delete any relation between two cards, regardless of direction. */
async function clearRelation(a: string, b: string) {
  await db
    .deleteFrom("card_relations")
    .where((eb) =>
      eb.or([
        eb.and([eb("card_id", "=", a), eb("related_card_id", "=", b)]),
        eb.and([eb("card_id", "=", b), eb("related_card_id", "=", a)]),
      ]),
    )
    .execute();
}

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
  /** Boards across the caller's teams (each carries its team_id/name so the
   *  UI can group them). */
  list: authP.handler(async (info) => {
    const teamIds = await myTeamIds(info.context.user.id);
    if (teamIds.length === 0) return [];

    const boards = await db
      .selectFrom("boards")
      .innerJoin("teams", "teams.id", "boards.team_id")
      .leftJoin("board_columns", "board_columns.board_id", "boards.id")
      .leftJoin("cards", "cards.column_id", "board_columns.id")
      .where("boards.team_id", "in", teamIds)
      .select(({ fn }) => [
        "boards.id",
        "boards.name",
        "boards.team_id",
        "teams.name as teamName",
        "boards.created_at",
        fn.count<number>("cards.id").distinct().as("cardCount"),
      ])
      .groupBy([
        "boards.id",
        "boards.name",
        "boards.team_id",
        "teams.name",
        "boards.created_at",
      ])
      .orderBy("boards.created_at", "asc")
      .execute();

    // count(*) is bigint → pg hands it over as a string.
    return boards.map((b) => ({ ...b, cardCount: Number(b.cardCount) }));
  }),

  create: authP
    .input(
      z.object({
        teamId: z.uuid(),
        name: z.string().trim().min(1).max(80),
      }),
    )
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      const board = await db
        .insertInto("boards")
        .values({
          name: info.input.name,
          team_id: info.input.teamId,
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
      await assertBoardAccess(info.context.user.id, info.input.boardId);
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

      const assignees = cards.length
        ? await db
            .selectFrom("card_assignees")
            .innerJoin("users", "users.id", "card_assignees.user_id")
            .where(
              "card_assignees.card_id",
              "in",
              cards.map((c) => c.id),
            )
            .select(["card_assignees.card_id", "users.id", "users.name"])
            .execute()
        : [];

      // Relations are stored normalized (card_id < related_card_id) — fetch
      // both directions for the board's cards and join the other side's
      // title for display.
      const cardIds = cards.map((c) => c.id);
      const relations = cards.length
        ? await db
            .selectFrom("card_relations")
            .innerJoin("cards as a", "a.id", "card_relations.card_id")
            .innerJoin("cards as b", "b.id", "card_relations.related_card_id")
            .where((eb) =>
              eb.or([
                eb("card_relations.card_id", "in", cardIds),
                eb("card_relations.related_card_id", "in", cardIds),
              ]),
            )
            .select([
              "card_relations.card_id as aId",
              "card_relations.related_card_id as bId",
              "card_relations.kind",
              "a.title as aTitle",
              "b.title as bTitle",
            ])
            .execute()
        : [];

      // Kind from this card's perspective: a directed 'blocks' row reads as
      // "blocks" from the blocker and "blocked_by" from the blocked card.
      const relationsOf = (cardId: string) =>
        relations
          .filter((r) => r.aId === cardId || r.bId === cardId)
          .map((r) =>
            r.aId === cardId
              ? {
                  cardId: r.bId,
                  title: r.bTitle,
                  kind: r.kind === "blocks" ? ("blocks" as const) : ("related" as const),
                }
              : {
                  cardId: r.aId,
                  title: r.aTitle,
                  kind: r.kind === "blocks" ? ("blocked_by" as const) : ("related" as const),
                },
          );

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
        assignees: assignees
          .filter((a) => a.card_id === card.id)
          .map((a) => ({ id: a.id, name: a.name })),
        relations: relationsOf(card.id),
        // count(*) is bigint → pg hands it over as a string.
        commentCount: Number(
          commentCounts.find((c) => c.entity_id === card.id)?.count ?? 0,
        ),
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
      await assertBoardAccess(info.context.user.id, info.input.boardId);
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

  renameColumn: authP
    .input(
      z.object({
        columnId: z.uuid(),
        name: z.string().trim().min(1).max(80),
      }),
    )
    .handler(async (info) => {
      await assertColumnAccess(info.context.user.id, info.input.columnId);
      await db
        .updateTable("board_columns")
        .set({ name: info.input.name })
        .where("id", "=", info.input.columnId)
        .execute();
    }),

  /** Reorder a column. `position` (float, midpoint-of-neighbors computed
   *  client-side) places it; omitted = append at end of its board. */
  moveColumn: authP
    .input(
      z.object({
        columnId: z.uuid(),
        position: z.number().finite().optional(),
      }),
    )
    .handler(async (info) => {
      await assertColumnAccess(info.context.user.id, info.input.columnId);
      let position = info.input.position;
      if (position === undefined) {
        const col = await db
          .selectFrom("board_columns")
          .where("id", "=", info.input.columnId)
          .select("board_id")
          .executeTakeFirstOrThrow();
        const row = await db
          .selectFrom("board_columns")
          .where("board_id", "=", col.board_id)
          .select((eb) => eb.fn.max("position").as("max"))
          .executeTakeFirst();
        position = (row?.max ?? 0) + 1;
      }
      await db
        .updateTable("board_columns")
        .set({ position })
        .where("id", "=", info.input.columnId)
        .execute();
    }),

  deleteColumn: authP
    .input(z.object({ columnId: z.uuid() }))
    .handler(async (info) => {
      await assertColumnAccess(info.context.user.id, info.input.columnId);
      // Clean up the polymorphic comments of this column's cards (no FK)
      // before the cascade wipes the cards.
      const cards = await db
        .selectFrom("cards")
        .where("column_id", "=", info.input.columnId)
        .select("id")
        .execute();
      await deleteCommentsOf(
        "card",
        cards.map((c) => c.id),
      );
      await db
        .deleteFrom("board_columns")
        .where("id", "=", info.input.columnId)
        .execute();
    }),

  createCard: authP
    .input(
      z.object({
        columnId: z.uuid(),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .handler(async (info) => {
      await assertColumnAccess(info.context.user.id, info.input.columnId);
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
        /** Replaces the full assignee set when provided. */
        assigneeIds: z.array(z.string()).max(50).optional(),
      }),
    )
    .handler(async (info) => {
      const { cardId, assigneeIds, ...patch } = info.input;
      await assertCardAccess(info.context.user.id, cardId);

      if (Object.keys(patch).length > 0) {
        await db
          .updateTable("cards")
          .set({
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.description !== undefined && {
              description: patch.description,
              description_text: extractLexicalText(patch.description),
            }),
            ...(patch.tags !== undefined && { tags: patch.tags }),
          })
          .where("id", "=", cardId)
          .execute();
      }

      if (assigneeIds !== undefined) {
        await db
          .deleteFrom("card_assignees")
          .where("card_id", "=", cardId)
          .execute();
        if (assigneeIds.length > 0) {
          // Only assign people who are members of the card's team.
          const valid = await db
            .selectFrom("team_members")
            .innerJoin("boards", "boards.team_id", "team_members.team_id")
            .innerJoin("board_columns", "board_columns.board_id", "boards.id")
            .innerJoin("cards", "cards.column_id", "board_columns.id")
            .where("cards.id", "=", cardId)
            .where("team_members.user_id", "in", assigneeIds)
            .select("team_members.user_id")
            .execute();
          if (valid.length > 0) {
            await db
              .insertInto("card_assignees")
              .values(
                valid.map((v) => ({ card_id: cardId, user_id: v.user_id })),
              )
              .onConflict((oc) => oc.doNothing())
              .execute();
          }
        }
      }
    }),

  /** Link two cards. `kind` is from the perspective of `cardId`:
   *  - "related":    plain undirected association
   *  - "blocks":     cardId blocks relatedCardId (it depends on cardId)
   *  - "blocked_by": cardId is blocked by relatedCardId
   *  One relation per pair — adding replaces whatever was there. */
  addRelation: authP
    .input(
      z.object({
        cardId: z.uuid(),
        relatedCardId: z.uuid(),
        kind: z.enum(["related", "blocks", "blocked_by"]).default("related"),
      }),
    )
    .handler(async (info) => {
      const { cardId, relatedCardId, kind } = info.input;
      // Both cards must be reachable by the caller (they share a team).
      await assertCardAccess(info.context.user.id, cardId);
      await assertCardAccess(info.context.user.id, relatedCardId);
      if (cardId === relatedCardId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A card cannot relate to itself.",
        });
      }

      // Normalize to a storage row: 'related' sorts the pair; 'blocked_by'
      // is stored as the inverse 'blocks'.
      let from: string;
      let to: string;
      let storedKind: "related" | "blocks";
      if (kind === "related") {
        [from, to] = [cardId, relatedCardId].sort() as [string, string];
        storedKind = "related";
      } else if (kind === "blocks") {
        [from, to, storedKind] = [cardId, relatedCardId, "blocks"];
      } else {
        [from, to, storedKind] = [relatedCardId, cardId, "blocks"];
      }

      await clearRelation(cardId, relatedCardId);
      await db
        .insertInto("card_relations")
        .values({ card_id: from, related_card_id: to, kind: storedKind })
        .execute();
    }),

  removeRelation: authP
    .input(z.object({ cardId: z.uuid(), relatedCardId: z.uuid() }))
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await clearRelation(info.input.cardId, info.input.relatedCardId);
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
      // Source card and destination column must both be in the caller's teams
      // (and, since boards are team-scoped, implicitly the same team).
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await assertColumnAccess(info.context.user.id, info.input.columnId);
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
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await deleteCommentsOf("card", [info.input.cardId]);
      await db.deleteFrom("cards").where("id", "=", info.input.cardId).execute();
    }),

  deleteBoard: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async (info) => {
      await assertBoardAccess(info.context.user.id, info.input.boardId);
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
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await db
        .insertInto("card_attachments")
        .values({ card_id: info.input.cardId, file_id: info.input.fileId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }),

  removeAttachment: authP
    .input(z.object({ cardId: z.uuid(), fileId: z.uuid() }))
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await db
        .deleteFrom("card_attachments")
        .where("card_id", "=", info.input.cardId)
        .where("file_id", "=", info.input.fileId)
        .execute();
    }),
};
