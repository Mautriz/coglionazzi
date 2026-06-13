import { call, ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { gameRouter } from "../src/server/orpc/game";
import { closeEmptyLobby } from "../src/server/orpc/game/sessions";
import { joinGamePresence } from "../src/server/realtime/gamePublisher";
import { __setVersusTimings } from "../src/server/realtime/versusEngine";
import { createTestTeam, signUpTestUser } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ctx = Awaited<ReturnType<typeof signUpTestUser>>["context"];

async function userIdOf(email: string): Promise<string> {
  const u = await db
    .selectFrom("users")
    .where("email", "=", email)
    .select("id")
    .executeTakeFirstOrThrow();
  return u.id;
}

/** Insert a bare file row (skip the real upload path) and return its id. */
async function makeFile(userId: string): Promise<string> {
  const { id } = await db
    .insertInto("files")
    .values({
      path: "x.webp",
      user_id: userId,
      metadata: JSON.stringify({ name: "x", type: "image/webp", size: 1 }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return id;
}

/** A deck with `n` cards owned by the context's user. */
async function makeDeck(context: Ctx, userId: string, n: number) {
  const fileIds = await Promise.all(
    Array.from({ length: n }, () => makeFile(userId)),
  );
  const { id } = await call(
    gameRouter.decks.create,
    {
      name: "Deck",
      cards: fileIds.map((fileId, i) => ({ fileId, title: `Card ${i}` })),
    },
    { context },
  );
  return id;
}

describe("game decks", () => {
  it("creates, reads and edits a deck; non-owner can't edit", async () => {
    const { context: alice, email } = await signUpTestUser("Alice");
    const aliceId = await userIdOf(email);
    const deckId = await makeDeck(alice, aliceId, 4);

    const deck = await call(gameRouter.decks.get, { deckId }, { context: alice });
    expect(deck.cards).toHaveLength(4);
    expect(deck.isMine).toBe(true);

    const { context: bob } = await signUpTestUser("Bob");
    const asBob = await call(gameRouter.decks.get, { deckId }, { context: bob });
    expect(asBob.isMine).toBe(false);
    await expect(
      call(
        gameRouter.decks.update,
        { deckId, name: "hijack" },
        { context: bob },
      ),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(
        gameRouter.decks.removeCard,
        { cardId: deck.cards[0].id },
        { context: bob },
      ),
    ).rejects.toThrowError(ORPCError);
  });

  it("anyone can clone a deck into their own editable copy", async () => {
    const { context: alice, email } = await signUpTestUser("Alice");
    const aliceId = await userIdOf(email);
    const deckId = await makeDeck(alice, aliceId, 4);

    const { context: bob } = await signUpTestUser("Bob");
    const { id: cloneId } = await call(
      gameRouter.decks.clone,
      { deckId },
      { context: bob },
    );
    expect(cloneId).not.toBe(deckId);

    const clone = await call(
      gameRouter.decks.get,
      { deckId: cloneId },
      { context: bob },
    );
    expect(clone.isMine).toBe(true);
    expect(clone.name).toContain("(copy)");
    expect(clone.cards).toHaveLength(4);
    // Bob owns the copy → he can edit it.
    await call(
      gameRouter.decks.update,
      { deckId: cloneId, name: "Bob's deck" },
      { context: bob },
    );
  });
});

describe("game sessions — access", () => {
  it("team-private is members-only; link-only and public are open to all", async () => {
    const { context: alice, email } = await signUpTestUser("Alice");
    const aliceId = await userIdOf(email);
    const teamId = await createTestTeam(alice);
    const deckId = await makeDeck(alice, aliceId, 4);

    const teamPriv = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "private", teamId },
      { context: alice },
    );
    // Private with NO team → link-only, anyone with the link can join.
    const linkOnly = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "private" },
      { context: alice },
    );
    const pub = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context: alice },
    );

    const { context: bob } = await signUpTestUser("Bob");
    // Bob isn't on Alice's team → only the team-scoped one is forbidden.
    await expect(
      call(gameRouter.sessions.get, { sessionId: teamPriv.id }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    expect(
      (await call(gameRouter.sessions.get, { sessionId: linkOnly.id }, { context: bob })).status,
    ).toBe("lobby");
    expect(
      (await call(gameRouter.sessions.get, { sessionId: pub.id }, { context: bob })).status,
    ).toBe("lobby");

    // Private games are unlisted — only the public one shows in the list.
    const listed = await call(gameRouter.sessions.list, undefined, {
      context: bob,
    });
    const ids = listed.map((s) => s.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(linkOnly.id);
    expect(ids).not.toContain(teamPriv.id);
  });
});

describe("game lobbies — auto-close when empty", () => {
  it("deletes an empty lobby and its game chat room", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );
    // Seed the session's game chat room (lazily made on first open).
    await db
      .insertInto("chat_rooms")
      .values({ kind: "game", owner_id: sessionId })
      .execute();

    await closeEmptyLobby(sessionId);

    const session = await db
      .selectFrom("game_sessions")
      .where("id", "=", sessionId)
      .select("id")
      .executeTakeFirst();
    expect(session).toBeUndefined();
    const room = await db
      .selectFrom("chat_rooms")
      .where("kind", "=", "game")
      .where("owner_id", "=", sessionId)
      .select("id")
      .executeTakeFirst();
    expect(room).toBeUndefined();
  });

  it("keeps a lobby that still has a viewer present", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );
    joinGamePresence(sessionId, { userId, name: "Host", image: null });

    await closeEmptyLobby(sessionId);

    const session = await db
      .selectFrom("game_sessions")
      .where("id", "=", sessionId)
      .select("id")
      .executeTakeFirst();
    expect(session).toBeDefined();
  });

  it("never closes a started (active) game even with no one present", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );
    await db
      .updateTable("game_sessions")
      .set({ status: "active" })
      .where("id", "=", sessionId)
      .execute();

    await closeEmptyLobby(sessionId);

    const session = await db
      .selectFrom("game_sessions")
      .where("id", "=", sessionId)
      .select("status")
      .executeTakeFirst();
    expect(session?.status).toBe("active");
  });
});

describe("game versus — start + vote", () => {
  it("validates start and seeds round 1", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );

    // Not a power of 2 / bigger than the deck → rejected.
    await expect(
      call(gameRouter.versus.start, { sessionId, cardCount: 3 }, { context }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(gameRouter.versus.start, { sessionId, cardCount: 8 }, { context }),
    ).rejects.toThrowError(ORPCError);

    // Non-host can't start.
    const { context: other } = await signUpTestUser("Other");
    await expect(
      call(
        gameRouter.versus.start,
        { sessionId, cardCount: 4 },
        { context: other },
      ),
    ).rejects.toThrowError(ORPCError);

    await call(
      gameRouter.versus.start,
      { sessionId, cardCount: 4 },
      { context },
    );
    const g = await call(gameRouter.sessions.get, { sessionId }, { context });
    expect(g.status).toBe("active");
    expect(g.cardCount).toBe(4);
    // 4 cards → round 1 has 2 matchups, one of them active.
    expect(g.matchups.filter((m) => m.round === 1)).toHaveLength(2);
    expect(g.currentMatchup).not.toBeNull();
    expect(g.currentMatchup?.left).not.toBeNull();
    expect(g.currentMatchup?.right).not.toBeNull();
  });

  it("only roster players can vote; votes are counted", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );

    // Put a second player in the lobby so one vote is 50% (not 100%, which
    // would auto-resolve the matchup) — the matchup stays open to inspect.
    const { email: mateEmail } = await signUpTestUser("Mate");
    const mateId = await userIdOf(mateEmail);
    joinGamePresence(sessionId, { userId: mateId, name: "Mate", image: null });

    await call(gameRouter.versus.start, { sessionId, cardCount: 4 }, { context });

    let g = await call(gameRouter.sessions.get, { sessionId }, { context });
    const matchupId = g.currentMatchup!.id;

    // The host (frozen into the roster at start) can vote.
    await call(gameRouter.versus.vote, { matchupId, choice: "left" }, { context });
    g = await call(gameRouter.sessions.get, { sessionId }, { context });
    expect(g.currentMatchup?.leftVotes).toBe(1);
    expect(g.currentMatchup?.myVote).toBe("left");

    // A non-roster spectator cannot.
    const { context: spectator } = await signUpTestUser("Spec");
    await expect(
      call(
        gameRouter.versus.vote,
        { matchupId, choice: "right" },
        { context: spectator },
      ),
    ).rejects.toThrowError(ORPCError);
  });
});

describe("game versus — bracket resolution", () => {
  // Real timers, just tiny: solo roster → every vote trips the 50% threshold,
  // collapsing each matchup to the (here ~15ms) short countdown.
  afterEach(() => __setVersusTimings(60_000, 10_000));

  it("plays a 4-card bracket down to one champion", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 4);
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );

    // full, short, reveal — all tiny so the bracket plays in milliseconds.
    __setVersusTimings(80, 15, 10);
    await call(gameRouter.versus.start, { sessionId, cardCount: 4 }, { context });

    // Three matchups: round1 x2, then the final.
    for (let i = 0; i < 3; i++) {
      const g = await call(
        gameRouter.sessions.get,
        { sessionId },
        { context },
      );
      expect(g.status).toBe("active");
      const matchupId = g.currentMatchup!.id;
      await call(
        gameRouter.versus.vote,
        { matchupId, choice: "left" },
        { context },
      );
      // Let the short countdown fire and the next matchup open.
      await sleep(60);
    }

    const done = await call(gameRouter.sessions.get, { sessionId }, { context });
    expect(done.status).toBe("finished");
    expect(done.winner).not.toBeNull();
    // The champion is one of the deck's cards.
    expect(done.cards.map((c) => c.id)).toContain(done.winner!.id);
    // Every matchup resolved with a winner.
    expect(done.matchups.every((m) => m.winnerCardId)).toBe(true);

    // Stats reflect the completed game.
    const stats = await call(gameRouter.decks.stats, { deckId }, { context });
    expect(stats.gamesPlayed).toBe(1);
    const champ = stats.cards.find((c) => c.id === done.winner!.id)!;
    expect(champ.championships).toBe(1);
    expect(champ.wins).toBeGreaterThanOrEqual(1);
    // 4 cards, all appeared in round 1.
    expect(stats.cards.filter((c) => c.appearances > 0)).toHaveLength(4);
  });

  it("resolves immediately once everyone has voted (no waiting for the timer)", async () => {
    const { context, email } = await signUpTestUser();
    const userId = await userIdOf(email);
    const deckId = await makeDeck(context, userId, 2); // 2 cards → a single final
    const { id: sessionId } = await call(
      gameRouter.sessions.create,
      { deckId, visibility: "public" },
      { context },
    );

    // Deliberately LONG timers — only the 100%-voted shortcut can end it fast.
    __setVersusTimings(5_000, 5_000, 10);
    await call(gameRouter.versus.start, { sessionId, cardCount: 2 }, { context });

    const g = await call(gameRouter.sessions.get, { sessionId }, { context });
    await call(
      gameRouter.versus.vote,
      { matchupId: g.currentMatchup!.id, choice: "left" },
      { context },
    );
    await sleep(80); // far below the 5s timer

    const done = await call(gameRouter.sessions.get, { sessionId }, { context });
    expect(done.status).toBe("finished");
  });
});
