import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db";
import { fileUrl, type FileMetadata } from "../files";
import { extractLexicalText } from "../lexicalText";
import {
  publishBoardChanged,
  publishBoardOfCard,
  publishBoardOfColumn,
  publishTeamChanged,
  publisher,
} from "../realtime/publisher";
import { authP } from "./base";
import {
  assertBoardAccess,
  assertCardAccess,
  assertColumnAccess,
  assertTeamMember,
  myTeamIds,
} from "./teamAccess";

/** Permanently delete the chat rooms bound to these cards (cascades their
 *  messages + reactions). A card's discussion thread is a 'card'-kind room
 *  with no FK on owner_id, so card owners call this from their delete paths
 *  (currently archive.purge). */
export async function deleteCardRooms(cardIds: string[]) {
  if (cardIds.length === 0) return;
  await db
    .deleteFrom("chat_rooms")
    .where("kind", "=", "card")
    .where("owner_id", "in", cardIds)
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
export async function nextCardPosition(columnId: string): Promise<number> {
  const row = await db
    .selectFrom("cards")
    .where("column_id", "=", columnId)
    .select((eb) => eb.fn.max("position").as("max"))
    .executeTakeFirst();
  return (row?.max ?? 0) + 1;
}

type CardRow = { id: string; description: unknown | null };

/** Resolve a set of cards into the fully-nested shape the UI expects:
 *  serialized description, assignees, perspective-aware relations, comment
 *  count, attachment files. Shared by `board.get` and `archive.list`.
 *  `liveRelationsOnly` excludes archived counterparts (boards hide relations
 *  to archived cards; the archive shows relations among archived cards). */
export async function attachCardExtras<T extends CardRow>(
  cards: T[],
  { liveRelationsOnly }: { liveRelationsOnly: boolean },
) {
  if (cards.length === 0) return [];
  const cardIds = cards.map((c) => c.id);

  const attachments = await db
    .selectFrom("card_attachments")
    .innerJoin("files", "files.id", "card_attachments.file_id")
    .where("card_attachments.card_id", "in", cardIds)
    .select([
      "card_attachments.card_id",
      "files.id",
      "files.path",
      "files.metadata",
    ])
    .execute();

  const assignees = await db
    .selectFrom("card_assignees")
    .innerJoin("users", "users.id", "card_assignees.user_id")
    .where("card_assignees.card_id", "in", cardIds)
    .select(["card_assignees.card_id", "users.id", "users.name"])
    .execute();

  // Relations are stored normalized (card_id < related_card_id) — fetch both
  // directions for these cards and join the other side's title for display.
  let relationQuery = db
    .selectFrom("card_relations")
    .innerJoin("cards as a", "a.id", "card_relations.card_id")
    .innerJoin("cards as b", "b.id", "card_relations.related_card_id")
    .where((eb) =>
      eb.or([
        eb("card_relations.card_id", "in", cardIds),
        eb("card_relations.related_card_id", "in", cardIds),
      ]),
    );
  if (liveRelationsOnly) {
    relationQuery = relationQuery
      .where("a.archived_at", "is", null)
      .where("b.archived_at", "is", null);
  }
  const relations = await relationQuery
    .select([
      "card_relations.card_id as aId",
      "card_relations.related_card_id as bId",
      "card_relations.kind",
      "a.title as aTitle",
      "b.title as bTitle",
    ])
    .execute();

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

  // Card threads are 'card'-kind chat rooms now — count their messages.
  const commentCounts = await db
    .selectFrom("chat_messages")
    .innerJoin("chat_rooms", "chat_rooms.id", "chat_messages.room_id")
    .where("chat_rooms.kind", "=", "card")
    .where("chat_rooms.owner_id", "in", cardIds)
    .select(({ fn }) => [
      "chat_rooms.owner_id as entity_id",
      fn.count<number>("chat_messages.id").as("count"),
    ])
    .groupBy("chat_rooms.owner_id")
    .execute();

  return cards.map((card) => ({
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
}

export const boardRouter = {
  /** Live board changes: an Event Iterator that yields whenever this board's
   *  columns/cards change (any mutation publishes to the `board` channel).
   *  The client refetches `board.get` on each event (signal-and-refetch). */
  subscribe: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async function* (info): AsyncGenerator<{ boardId: string }> {
      await assertBoardAccess(info.context.user.id, info.input.boardId);
      for await (const event of publisher.subscribe("board", {
        signal: info.signal,
      })) {
        if (event.boardId === info.input.boardId) {
          yield { boardId: event.boardId };
        }
      }
    }),

  /** Boards across the caller's teams (each carries its team_id/name so the
   *  UI can group them). */
  list: authP.handler(async (info) => {
    const teamIds = await myTeamIds(info.context.user.id);
    if (teamIds.length === 0) return [];

    const boards = await db
      .selectFrom("boards")
      .innerJoin("teams", "teams.id", "boards.team_id")
      .leftJoin("board_columns", "board_columns.board_id", "boards.id")
      // Archived cards are detached/hidden — keep them out of the count.
      .leftJoin("cards", (join) =>
        join
          .onRef("cards.column_id", "=", "board_columns.id")
          .on("cards.archived_at", "is", null),
      )
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

      // New board shows up in every team member's sidebar.
      publishTeamChanged(info.input.teamId);
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
            .where("archived_at", "is", null)
            .selectAll()
            .orderBy("position", "asc")
            .execute()
        : [];

      const cardsWithExtras = await attachCardExtras(cards, {
        liveRelationsOnly: true,
      });

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

      const created = await db
        .insertInto("board_columns")
        .values({
          board_id: info.input.boardId,
          name: info.input.name,
          position: (row?.max ?? 0) + 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      publishBoardChanged(info.input.boardId);
      return created;
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
      await publishBoardOfColumn(info.input.columnId);
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
      await publishBoardOfColumn(info.input.columnId);
    }),

  deleteColumn: authP
    .input(z.object({ columnId: z.uuid() }))
    .handler(async (info) => {
      await assertColumnAccess(info.context.user.id, info.input.columnId);
      // Resolve the board before the column is gone, so we can announce the
      // change after the delete.
      const owning = await db
        .selectFrom("board_columns")
        .where("id", "=", info.input.columnId)
        .select("board_id")
        .executeTakeFirst();
      // Archive the column's live cards (snapshotting their origin) before the
      // column goes — the FK's ON DELETE SET NULL then detaches them, so they
      // survive in the team archive instead of cascade-deleting.
      const origin = await db
        .selectFrom("board_columns")
        .innerJoin("boards", "boards.id", "board_columns.board_id")
        .where("board_columns.id", "=", info.input.columnId)
        .select(["boards.name as boardName", "board_columns.name as columnName"])
        .executeTakeFirst();
      await db
        .updateTable("cards")
        .set({
          archived_at: sql`now()`,
          archived_by: info.context.user.id,
          archived_origin: origin
            ? `${origin.boardName} / ${origin.columnName}`
            : null,
        })
        .where("column_id", "=", info.input.columnId)
        .where("archived_at", "is", null)
        .execute();
      await db
        .deleteFrom("board_columns")
        .where("id", "=", info.input.columnId)
        .execute();
      if (owning) publishBoardChanged(owning.board_id);
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
      // team_id is denormalized onto the card (so the archive survives the
      // column/board being deleted) — resolve it from the column's board.
      const { team_id } = await db
        .selectFrom("board_columns")
        .innerJoin("boards", "boards.id", "board_columns.board_id")
        .where("board_columns.id", "=", info.input.columnId)
        .select("boards.team_id")
        .executeTakeFirstOrThrow();
      const created = await db
        .insertInto("cards")
        .values({
          column_id: info.input.columnId,
          team_id,
          title: info.input.title,
          position: await nextCardPosition(info.input.columnId),
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await publishBoardOfColumn(info.input.columnId);
      return created;
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

      await publishBoardOfCard(cardId);
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
      // Both cards' boards reflect the new relation.
      await publishBoardOfCard(cardId);
      await publishBoardOfCard(relatedCardId);
    }),

  removeRelation: authP
    .input(z.object({ cardId: z.uuid(), relatedCardId: z.uuid() }))
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      await clearRelation(info.input.cardId, info.input.relatedCardId);
      await publishBoardOfCard(info.input.cardId);
      await publishBoardOfCard(info.input.relatedCardId);
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
      // Capture the source board before the move so we can notify it too (a
      // move can in principle cross boards within a team; usually it's the
      // same board and the duplicate event is harmless).
      const source = await db
        .selectFrom("cards")
        .innerJoin("board_columns", "board_columns.id", "cards.column_id")
        .where("cards.id", "=", info.input.cardId)
        .select("board_columns.board_id")
        .executeTakeFirst();
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
      await publishBoardOfColumn(info.input.columnId);
      if (source) publishBoardChanged(source.board_id);
    }),

  /** Soft-delete: send a card to its team's archive. Keeps column_id so it
   *  can be restored in place; snapshots its origin for display. Permanent
   *  deletion lives in the archive router (`archive.purge`). */
  archiveCard: authP
    .input(z.object({ cardId: z.uuid() }))
    .handler(async (info) => {
      await assertCardAccess(info.context.user.id, info.input.cardId);
      const origin = await db
        .selectFrom("cards")
        .innerJoin("board_columns", "board_columns.id", "cards.column_id")
        .innerJoin("boards", "boards.id", "board_columns.board_id")
        .where("cards.id", "=", info.input.cardId)
        .select(["boards.name as boardName", "board_columns.name as columnName"])
        .executeTakeFirst();
      await db
        .updateTable("cards")
        .set({
          archived_at: sql`now()`,
          archived_by: info.context.user.id,
          archived_origin: origin
            ? `${origin.boardName} / ${origin.columnName}`
            : null,
        })
        .where("id", "=", info.input.cardId)
        .where("archived_at", "is", null)
        .execute();
      // archiveCard keeps column_id, so the board still resolves off the card.
      await publishBoardOfCard(info.input.cardId);
    }),

  deleteBoard: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async (info) => {
      await assertBoardAccess(info.context.user.id, info.input.boardId);
      // Resolve the owning team before the board is gone (for the sidebar).
      const owner = await db
        .selectFrom("boards")
        .where("id", "=", info.input.boardId)
        .select("team_id")
        .executeTakeFirst();
      // Archive the board's live cards (origin = "<board> / <column>") before
      // it goes. Deleting the board cascades its columns, whose ON DELETE SET
      // NULL detaches these cards — they live on in the team archive.
      await sql`
        update cards
        set archived_at = now(),
            archived_by = ${info.context.user.id},
            archived_origin = boards.name || ' / ' || board_columns.name
        from board_columns, boards
        where cards.column_id = board_columns.id
          and board_columns.board_id = boards.id
          and board_columns.board_id = ${info.input.boardId}
          and cards.archived_at is null
      `.execute(db);

      await db
        .deleteFrom("boards")
        .where("id", "=", info.input.boardId)
        .execute();
      publishBoardChanged(info.input.boardId);
      // Drop the board from every team member's sidebar.
      if (owner) publishTeamChanged(owner.team_id);
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
      await publishBoardOfCard(info.input.cardId);
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
      await publishBoardOfCard(info.input.cardId);
    }),
};
