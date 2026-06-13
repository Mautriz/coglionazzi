import { sql } from "kysely";
import { z } from "zod";
import { db } from "../../db";
import { fileUrl } from "../../files";
import { authP } from "../base";
import { assertDeckOwner, deckIdOfCard } from "./access";

/** `game.decks.*` — reusable image sets ("decks") any game runs on. Decks are
 *  global: anyone can browse/play one; only the creator can edit. A deck is
 *  edited in place (add/update/remove cards), like the kanban card dialog. */
export const deckRouter = {
  /** All decks, newest first, with card counts and creator. */
  list: authP.handler(async (info) => {
    const decks = await db
      .selectFrom("game_decks")
      .leftJoin("users", "users.id", "game_decks.created_by")
      .leftJoin(
        (eb) =>
          eb
            .selectFrom("game_deck_cards")
            .select(["deck_id", eb.fn.countAll<number>().as("count")])
            .groupBy("deck_id")
            .as("cc"),
        (join) => join.onRef("cc.deck_id", "=", "game_decks.id"),
      )
      .select([
        "game_decks.id",
        "game_decks.name",
        "game_decks.description",
        "game_decks.created_by",
        "game_decks.created_at",
        "users.name as creatorName",
        sql<number>`coalesce(cc.count, 0)`.as("cardCount"),
      ])
      .orderBy("game_decks.created_at", "desc")
      .execute();

    // Up to 4 cover images per deck (first by position) for the card preview.
    const deckIds = decks.map((d) => d.id);
    const previews = new Map<string, string[]>();
    if (deckIds.length) {
      const rows = await db
        .selectFrom((eb) =>
          eb
            .selectFrom("game_deck_cards")
            .innerJoin("files", "files.id", "game_deck_cards.file_id")
            .where("game_deck_cards.deck_id", "in", deckIds)
            .select([
              "game_deck_cards.deck_id as deckId",
              "files.path as path",
              sql<number>`row_number() over (partition by game_deck_cards.deck_id order by game_deck_cards.position)`.as(
                "rn",
              ),
            ])
            .as("ranked"),
        )
        .where("ranked.rn", "<=", 4)
        .select(["ranked.deckId", "ranked.path"])
        .execute();
      for (const r of rows) {
        const arr = previews.get(r.deckId) ?? [];
        arr.push(fileUrl(r.path));
        previews.set(r.deckId, arr);
      }
    }

    return decks.map((d) => ({
      ...d,
      cardCount: Number(d.cardCount),
      isMine: d.created_by === info.context.user.id,
      previews: previews.get(d.id) ?? [],
    }));
  }),

  /** A deck + its ordered cards (each with a resolved file URL). */
  get: authP
    .input(z.object({ deckId: z.uuid() }))
    .handler(async (info) => {
      const deck = await db
        .selectFrom("game_decks")
        .where("id", "=", info.input.deckId)
        .selectAll()
        .executeTakeFirst();
      if (!deck) throw new Error("Deck not found");

      const cards = await db
        .selectFrom("game_deck_cards")
        .innerJoin("files", "files.id", "game_deck_cards.file_id")
        .where("game_deck_cards.deck_id", "=", info.input.deckId)
        .select([
          "game_deck_cards.id",
          "game_deck_cards.file_id as fileId",
          "game_deck_cards.title",
          "game_deck_cards.description",
          "game_deck_cards.position",
          "files.path",
        ])
        .orderBy("game_deck_cards.position", "asc")
        .execute();

      return {
        id: deck.id,
        name: deck.name,
        description: deck.description,
        createdBy: deck.created_by,
        isMine: deck.created_by === info.context.user.id,
        cards: cards.map((c) => ({
          id: c.id,
          fileId: c.fileId,
          title: c.title,
          description: c.description,
          position: c.position,
          url: fileUrl(c.path),
        })),
      };
    }),

  /** Create a deck (optionally with initial cards). Returns the new id. */
  create: authP
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        cards: z
          .array(
            z.object({
              fileId: z.uuid(),
              title: z.string().trim().min(1).max(200),
              description: z.string().trim().max(1000).optional(),
            }),
          )
          .max(256)
          .optional(),
      }),
    )
    .handler(async (info) => {
      const { id } = await db
        .insertInto("game_decks")
        .values({
          name: info.input.name,
          description: info.input.description ?? null,
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (info.input.cards?.length) {
        await db
          .insertInto("game_deck_cards")
          .values(
            info.input.cards.map((c, i) => ({
              deck_id: id,
              file_id: c.fileId,
              title: c.title,
              description: c.description ?? null,
              position: i,
            })),
          )
          .execute();
      }

      return { id };
    }),

  /** Rename / re-describe a deck (creator-only). */
  update: authP
    .input(
      z.object({
        deckId: z.uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .handler(async (info) => {
      await assertDeckOwner(info.context.user.id, info.input.deckId);
      const { deckId, ...patch } = info.input;
      if (Object.keys(patch).length > 0) {
        await db
          .updateTable("game_decks")
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.description !== undefined && {
              description: patch.description,
            }),
          })
          .where("id", "=", deckId)
          .execute();
      }
    }),

  /** Append a card to a deck (creator-only). Returns the new card id. */
  addCard: authP
    .input(
      z.object({
        deckId: z.uuid(),
        fileId: z.uuid(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).optional(),
      }),
    )
    .handler(async (info) => {
      await assertDeckOwner(info.context.user.id, info.input.deckId);
      const last = await db
        .selectFrom("game_deck_cards")
        .where("deck_id", "=", info.input.deckId)
        .select((eb) => eb.fn.max("position").as("max"))
        .executeTakeFirst();
      const position = last?.max == null ? 0 : Number(last.max) + 1;
      const { id } = await db
        .insertInto("game_deck_cards")
        .values({
          deck_id: info.input.deckId,
          file_id: info.input.fileId,
          title: info.input.title,
          description: info.input.description ?? null,
          position,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id };
    }),

  /** Edit a card's title/description (creator-only). */
  updateCard: authP
    .input(
      z.object({
        cardId: z.uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .handler(async (info) => {
      const deckId = await deckIdOfCard(info.input.cardId);
      await assertDeckOwner(info.context.user.id, deckId);
      const { cardId, ...patch } = info.input;
      if (Object.keys(patch).length > 0) {
        await db
          .updateTable("game_deck_cards")
          .set({
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.description !== undefined && {
              description: patch.description,
            }),
          })
          .where("id", "=", cardId)
          .execute();
      }
    }),

  /** Remove a card from a deck (creator-only). */
  removeCard: authP
    .input(z.object({ cardId: z.uuid() }))
    .handler(async (info) => {
      const deckId = await deckIdOfCard(info.input.cardId);
      await assertDeckOwner(info.context.user.id, deckId);
      await db
        .deleteFrom("game_deck_cards")
        .where("id", "=", info.input.cardId)
        .execute();
    }),

  /** Clone any deck into a new one owned by the caller (so non-owners can copy
   *  + edit). Cards reference the same files (served by id). Returns the new id. */
  clone: authP
    .input(z.object({ deckId: z.uuid() }))
    .handler(async (info) => {
      const src = await db
        .selectFrom("game_decks")
        .where("id", "=", info.input.deckId)
        .select(["name", "description"])
        .executeTakeFirst();
      if (!src) throw new Error("Deck not found");

      const cards = await db
        .selectFrom("game_deck_cards")
        .where("deck_id", "=", info.input.deckId)
        .select(["file_id", "title", "description", "position"])
        .orderBy("position", "asc")
        .execute();

      const { id } = await db
        .insertInto("game_decks")
        .values({
          name: `${src.name} (copy)`,
          description: src.description,
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (cards.length) {
        await db
          .insertInto("game_deck_cards")
          .values(
            cards.map((c, i) => ({
              deck_id: id,
              file_id: c.file_id,
              title: c.title,
              description: c.description,
              position: i,
            })),
          )
          .execute();
      }
      return { id };
    }),

  /** Per-card stats across every Versus game played on this deck (completed
   *  matchups only): appearances, total votes, wins, championships, win rate.
   *  Sorted by wins then votes. */
  stats: authP
    .input(z.object({ deckId: z.uuid() }))
    .handler(async (info) => {
      const cards = await db
        .selectFrom("game_deck_cards")
        .innerJoin("files", "files.id", "game_deck_cards.file_id")
        .where("game_deck_cards.deck_id", "=", info.input.deckId)
        .select([
          "game_deck_cards.id",
          "game_deck_cards.title",
          "game_deck_cards.position",
          "files.path",
        ])
        .orderBy("game_deck_cards.position", "asc")
        .execute();

      const matchups = await db
        .selectFrom("versus_matchups")
        .innerJoin(
          "game_sessions",
          "game_sessions.id",
          "versus_matchups.session_id",
        )
        .where("game_sessions.deck_id", "=", info.input.deckId)
        .where("versus_matchups.status", "=", "done")
        .select([
          "versus_matchups.left_card_id as leftCardId",
          "versus_matchups.right_card_id as rightCardId",
          "versus_matchups.winner_card_id as winnerCardId",
          "versus_matchups.left_votes as leftVotes",
          "versus_matchups.right_votes as rightVotes",
        ])
        .execute();

      const champs = await db
        .selectFrom("game_sessions")
        .where("deck_id", "=", info.input.deckId)
        .where("status", "=", "finished")
        .where("winner_card_id", "is not", null)
        .select((eb) => [
          "winner_card_id",
          eb.fn.countAll<number>().as("c"),
        ])
        .groupBy("winner_card_id")
        .execute();

      const games = await db
        .selectFrom("game_sessions")
        .where("deck_id", "=", info.input.deckId)
        .where("status", "=", "finished")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .executeTakeFirst();

      const agg = new Map(
        cards.map((c) => [
          c.id,
          { appearances: 0, votes: 0, wins: 0, championships: 0 },
        ]),
      );
      for (const m of matchups) {
        const l = agg.get(m.leftCardId);
        if (l) {
          l.appearances++;
          l.votes += m.leftVotes;
        }
        const r = agg.get(m.rightCardId);
        if (r) {
          r.appearances++;
          r.votes += m.rightVotes;
        }
        if (m.winnerCardId) {
          const w = agg.get(m.winnerCardId);
          if (w) w.wins++;
        }
      }
      for (const ch of champs) {
        if (ch.winner_card_id) {
          const s = agg.get(ch.winner_card_id);
          if (s) s.championships = Number(ch.c);
        }
      }

      const rows = cards
        .map((c) => {
          const s = agg.get(c.id)!;
          return {
            id: c.id,
            title: c.title,
            url: fileUrl(c.path),
            appearances: s.appearances,
            votes: s.votes,
            wins: s.wins,
            championships: s.championships,
            winRate: s.appearances ? s.wins / s.appearances : 0,
          };
        })
        .sort((a, b) => b.wins - a.wins || b.votes - a.votes);

      return { gamesPlayed: Number(games?.c ?? 0), cards: rows };
    }),

  /** Delete a deck and its cards/sessions (creator-only). */
  delete: authP
    .input(z.object({ deckId: z.uuid() }))
    .handler(async (info) => {
      await assertDeckOwner(info.context.user.id, info.input.deckId);
      await db
        .deleteFrom("game_decks")
        .where("id", "=", info.input.deckId)
        .execute();
    }),
};
