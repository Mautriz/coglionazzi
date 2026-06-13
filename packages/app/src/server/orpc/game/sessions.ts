import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../../db";
import { fileUrl } from "../../files";
import {
  gamePresenceSnapshot,
  gamePublisher,
  joinGamePresence,
  type GameEvent,
} from "../../realtime/gamePublisher";
import { liveDeadline } from "../../realtime/versusEngine";
import { authP } from "../base";
import { assertTeamMember } from "../teamAccess";
import { assertSessionAccess } from "./access";
import { powerOfTwoSizes } from "./util";

/** Resolve a deck's cards as view models (image url + title + description). */
async function deckCardViews(deckId: string) {
  const rows = await db
    .selectFrom("game_deck_cards")
    .innerJoin("files", "files.id", "game_deck_cards.file_id")
    .where("game_deck_cards.deck_id", "=", deckId)
    .select([
      "game_deck_cards.id",
      "game_deck_cards.title",
      "game_deck_cards.description",
      "game_deck_cards.position",
      "files.path",
    ])
    .orderBy("game_deck_cards.position", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    url: fileUrl(r.path),
  }));
}

/** `game.sessions.*` — the shared lobby lifecycle (kind-agnostic). The in-game
 *  mechanic is the per-kind module (game.versus.*). */
export const sessionRouter = {
  /** Open + running PUBLIC lobbies. Private games are unlisted (join by link). */
  list: authP.handler(async () => {
    const rows = await db
      .selectFrom("game_sessions")
      .innerJoin("game_decks", "game_decks.id", "game_sessions.deck_id")
      .leftJoin("users", "users.id", "game_sessions.host_id")
      .where("game_sessions.status", "in", ["lobby", "active"])
      .where("game_sessions.visibility", "=", "public")
      .select([
        "game_sessions.id",
        "game_sessions.kind",
        "game_sessions.visibility",
        "game_sessions.status",
        "game_sessions.created_at",
        "game_decks.name as deckName",
        "users.name as hostName",
      ])
      .orderBy("game_sessions.created_at", "desc")
      .execute();

    // Player counts: live presence for lobbies, frozen roster for running games.
    const activeIds = rows.filter((r) => r.status !== "lobby").map((r) => r.id);
    const counts = new Map<string, number>();
    if (activeIds.length) {
      const grouped = await db
        .selectFrom("game_session_players")
        .where("session_id", "in", activeIds)
        .select((eb) => ["session_id", eb.fn.countAll<number>().as("c")])
        .groupBy("session_id")
        .execute();
      for (const g of grouped) counts.set(g.session_id, Number(g.c));
    }

    return rows.map((r) => ({
      ...r,
      playerCount:
        r.status === "lobby"
          ? gamePresenceSnapshot(r.id).length
          : (counts.get(r.id) ?? 0),
    }));
  }),

  /** Create a lobby from a deck. Private games require a team (members only). */
  create: authP
    .input(
      z.object({
        deckId: z.uuid(),
        kind: z.literal("versus").default("versus"),
        visibility: z.enum(["public", "private"]),
        teamId: z.uuid().optional(),
      }),
    )
    .handler(async (info) => {
      const { deckId, kind, visibility, teamId } = info.input;
      const deck = await db
        .selectFrom("game_decks")
        .where("id", "=", deckId)
        .select("id")
        .executeTakeFirst();
      if (!deck) throw new ORPCError("NOT_FOUND", { message: "Deck not found" });

      // A team is OPTIONAL — private with no team is link-only (anyone with the
      // link). When a team IS chosen, you must belong to it; only private games
      // are team-scoped (public ignores it).
      const scopedTeamId = visibility === "private" ? (teamId ?? null) : null;
      if (scopedTeamId) {
        await assertTeamMember(info.context.user.id, scopedTeamId);
      }

      const { id } = await db
        .insertInto("game_sessions")
        .values({
          deck_id: deckId,
          kind,
          visibility,
          team_id: scopedTeamId,
          host_id: info.context.user.id,
          status: "lobby",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id };
    }),

  /** Full current snapshot — lobby roster, the active matchup (with live counts
   *  + deadline), or the champion, plus the bracket so far for the results
   *  trail. The client seeds from this and applies `subscribe` events. */
  get: authP
    .input(z.object({ sessionId: z.uuid() }))
    .handler(async (info) => {
      const uid = info.context.user.id;
      const s = await assertSessionAccess(uid, info.input.sessionId);

      const deck = await db
        .selectFrom("game_decks")
        .where("id", "=", s.deck_id)
        .select(["id", "name"])
        .executeTakeFirstOrThrow();
      const host = s.host_id
        ? await db
            .selectFrom("users")
            .where("id", "=", s.host_id)
            .select("name")
            .executeTakeFirst()
        : null;

      const cards = await deckCardViews(s.deck_id);
      const cardById = new Map(cards.map((c) => [c.id, c]));

      // Players: live presence in a lobby, the frozen roster once running.
      const players =
        s.status === "lobby"
          ? gamePresenceSnapshot(info.input.sessionId)
          : (
              await db
                .selectFrom("game_session_players")
                .innerJoin("users", "users.id", "game_session_players.user_id")
                .where("session_id", "=", info.input.sessionId)
                .select([
                  "game_session_players.user_id as userId",
                  "users.name",
                  "users.image",
                ])
                .execute()
            ).map((r) => ({ userId: r.userId, name: r.name, image: r.image }));
      const amInRoster = players.some((p) => p.userId === uid);

      const matchups = await db
        .selectFrom("versus_matchups")
        .where("session_id", "=", info.input.sessionId)
        .orderBy("round", "asc")
        .orderBy("position", "asc")
        .select([
          "id",
          "round",
          "position",
          "left_card_id as leftCardId",
          "right_card_id as rightCardId",
          "winner_card_id as winnerCardId",
          "left_votes as leftVotes",
          "right_votes as rightVotes",
          "status",
        ])
        .execute();

      let currentMatchup = null;
      const active = matchups.find((m) => m.status === "active");
      if (s.status === "active" && active) {
        const voteRows = await db
          .selectFrom("versus_votes")
          .where("matchup_id", "=", active.id)
          .select(["user_id", "choice"])
          .execute();
        currentMatchup = {
          id: active.id,
          round: active.round,
          position: active.position,
          left: cardById.get(active.leftCardId) ?? null,
          right: cardById.get(active.rightCardId) ?? null,
          leftVotes: voteRows.filter((v) => v.choice === "left").length,
          rightVotes: voteRows.filter((v) => v.choice === "right").length,
          votedCount: voteRows.length,
          rosterSize: players.length,
          myVote:
            (voteRows.find((v) => v.user_id === uid)?.choice as
              | "left"
              | "right"
              | undefined) ?? null,
          deadline: liveDeadline(info.input.sessionId),
        };
      }

      return {
        id: s.id,
        deckId: deck.id,
        deckName: deck.name,
        kind: s.kind,
        visibility: s.visibility,
        teamId: s.team_id,
        status: s.status,
        hostId: s.host_id,
        hostName: host?.name ?? null,
        isHost: s.host_id === uid,
        cardCount: s.card_count,
        totalRounds: s.card_count ? Math.log2(s.card_count) : null,
        deckCardCount: cards.length,
        validSizes: powerOfTwoSizes(cards.length),
        players,
        rosterSize: players.length,
        canVote: s.status === "active" && amInRoster,
        currentMatchup,
        winner:
          s.status === "finished" && s.winner_card_id
            ? (cardById.get(s.winner_card_id) ?? null)
            : null,
        cards,
        matchups,
      };
    }),

  /** Join the session's live stream: registers presence (you appear in the
   *  lobby), yields the current roster, then streams game events. The `finally`
   *  deregisters when the socket closes. */
  subscribe: authP
    .input(z.object({ sessionId: z.uuid() }))
    .handler(async function* (info): AsyncGenerator<GameEvent> {
      await assertSessionAccess(info.context.user.id, info.input.sessionId);

      const leave = joinGamePresence(info.input.sessionId, {
        userId: info.context.user.id,
        name: info.context.user.name ?? null,
        image: info.context.user.image ?? null,
      });
      try {
        yield {
          type: "presence",
          players: gamePresenceSnapshot(info.input.sessionId),
        };
        for await (const event of gamePublisher.subscribe(
          info.input.sessionId,
          { signal: info.signal },
        )) {
          yield event;
        }
      } finally {
        leave();
      }
    }),
};
