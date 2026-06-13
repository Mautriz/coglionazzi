import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../../db";
import { gamePresenceSnapshot } from "../../realtime/gamePublisher";
import { recordVote, startVersus } from "../../realtime/versusEngine";
import { authP } from "../base";
import { assertSessionAccess } from "./access";
import { isPowerOfTwo, shuffle } from "./util";

/** `game.versus.*` — the bracket mechanic on top of a `game.sessions` lobby. */
export const versusRouter = {
  /** Host starts the game: freeze the present players as the roster, draw a
   *  random power-of-2 subset of the deck, seed round 1, open matchup #1. */
  start: authP
    .input(
      z.object({
        sessionId: z.uuid(),
        cardCount: z.number().int(),
      }),
    )
    .handler(async (info) => {
      const uid = info.context.user.id;
      const s = await assertSessionAccess(uid, info.input.sessionId);

      if (s.host_id !== uid) {
        throw new ORPCError("FORBIDDEN", {
          message: "Only the host can start the game.",
        });
      }
      if (s.status !== "lobby") {
        throw new ORPCError("BAD_REQUEST", {
          message: "This game has already started.",
        });
      }

      const deckCards = await db
        .selectFrom("game_deck_cards")
        .where("deck_id", "=", s.deck_id)
        .select("id")
        .execute();

      const { cardCount } = info.input;
      if (!isPowerOfTwo(cardCount) || cardCount > deckCards.length) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Card count must be a power of 2 within the deck size.",
        });
      }

      // Freeze the roster: everyone present in the lobby (+ the host, always).
      const present = gamePresenceSnapshot(info.input.sessionId).map(
        (p) => p.userId,
      );
      const rosterIds = [...new Set([...present, uid])];
      await db
        .insertInto("game_session_players")
        .values(
          rosterIds.map((userId) => ({
            session_id: info.input.sessionId,
            user_id: userId,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Random subset → shuffled bracket leaves → round-1 pairs.
      const chosen = shuffle(deckCards.map((c) => c.id)).slice(0, cardCount);
      const round1 = [];
      for (let i = 0; i < cardCount; i += 2) {
        round1.push({
          session_id: info.input.sessionId,
          round: 1,
          position: i / 2,
          left_card_id: chosen[i],
          right_card_id: chosen[i + 1],
          status: "pending",
        });
      }
      await db.insertInto("versus_matchups").values(round1).execute();

      await db
        .updateTable("game_sessions")
        .set({
          status: "active",
          card_count: cardCount,
          started_at: sql`now()`,
        })
        .where("id", "=", info.input.sessionId)
        .execute();

      await startVersus(info.input.sessionId, rosterIds.length);
      return { ok: true };
    }),

  /** Cast/change a left/right vote on the current matchup (roster players only,
   *  before the deadline). */
  vote: authP
    .input(
      z.object({
        matchupId: z.uuid(),
        choice: z.enum(["left", "right"]),
      }),
    )
    .handler(async (info) => {
      const uid = info.context.user.id;
      const matchup = await db
        .selectFrom("versus_matchups")
        .where("id", "=", info.input.matchupId)
        .select("session_id")
        .executeTakeFirst();
      if (!matchup) {
        throw new ORPCError("NOT_FOUND", { message: "Matchup not found" });
      }
      await assertSessionAccess(uid, matchup.session_id);

      const inRoster = await db
        .selectFrom("game_session_players")
        .where("session_id", "=", matchup.session_id)
        .where("user_id", "=", uid)
        .select("user_id")
        .executeTakeFirst();
      if (!inRoster) {
        throw new ORPCError("FORBIDDEN", {
          message: "Only players who were in the lobby at start can vote.",
        });
      }

      await recordVote(
        matchup.session_id,
        info.input.matchupId,
        uid,
        info.input.choice,
      );
      return { ok: true };
    }),
};
