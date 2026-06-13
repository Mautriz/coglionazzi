import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { boardRouter } from "../src/server/orpc/boards";
import { chatRouter } from "../src/server/orpc/chat";
import { teamRouter } from "../src/server/orpc/teams";
import type { ORPCContext } from "../src/server/orpc/base";
import {
  createTestTeam,
  lexicalState,
  openCardRoom,
  sendCardMessage,
  signUpTestUser,
} from "./helpers";

async function userIdByEmail(email: string): Promise<string> {
  const row = await db
    .selectFrom("users")
    .where("email", "=", email)
    .select("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeCard(context: ORPCContext) {
  const teamId = await createTestTeam(context);
  const { id: boardId } = await call(
    boardRouter.create,
    { teamId, name: "Board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  const { id: cardId } = await call(
    boardRouter.createCard,
    { columnId: board.columns[0].id, title: "Card" },
    { context },
  );
  return { teamId, boardId, cardId };
}

function nextWithin<T>(iter: AsyncIterator<T>, ms: number): Promise<T> {
  return Promise.race([
    iter.next().then((r) => r.value as T),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("no event within timeout")), ms),
    ),
  ]);
}
const settle = () => new Promise((r) => setTimeout(r, 40));

describe("chat room access", () => {
  it("global room is shared by everyone and open to any user", async () => {
    const { context: a } = await signUpTestUser("A");
    const { context: b } = await signUpTestUser("B");
    const ra = await call(chatRouter.open, { ref: { scope: "global" } }, {
      context: a,
    });
    const rb = await call(chatRouter.open, { ref: { scope: "global" } }, {
      context: b,
    });
    expect(ra.roomId).toBe(rb.roomId); // singleton
  });

  it("team room: members in, non-members out", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { context: outsider } = await signUpTestUser("Out");

    await call(chatRouter.open, { ref: { scope: "team", teamId } }, {
      context: owner,
    });
    await expect(
      call(chatRouter.open, { ref: { scope: "team", teamId } }, {
        context: outsider,
      }),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("card room follows card access", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const { cardId } = await makeCard(owner);
    const { context: outsider } = await signUpTestUser("Out");
    await openCardRoom(owner, cardId); // ok
    await expect(openCardRoom(outsider, cardId)).rejects.toBeInstanceOf(
      ORPCError,
    );
  });
});

describe("chat messages", () => {
  it("sends a message with author + string body, surfaced by open", async () => {
    const { context } = await signUpTestUser("Alice");
    const { cardId } = await makeCard(context);
    await sendCardMessage(context, cardId, "gg");

    const { messages } = await openCardRoom(context, cardId);
    expect(messages).toHaveLength(1);
    expect(messages[0].author).toBe("Alice");
    expect(typeof messages[0].body).toBe("string");
    expect(messages[0].reactions).toEqual([]);
  });

  it("pages history by keyset (open + history cover all messages)", async () => {
    const { context } = await signUpTestUser();
    const { cardId } = await makeCard(context);
    const { roomId } = await openCardRoom(context, cardId);
    for (const t of ["m1", "m2", "m3"]) {
      await call(chatRouter.send, { roomId, body: lexicalState(t) }, {
        context,
      });
    }

    const latest = await call(
      chatRouter.history,
      { roomId, limit: 2 },
      { context },
    );
    expect(latest).toHaveLength(2);
    const older = await call(
      chatRouter.history,
      {
        roomId,
        before: { createdAt: latest[0].createdAt, id: latest[0].id },
        limit: 2,
      },
      { context },
    );
    const allIds = new Set([...older, ...latest].map((m) => m.id));
    expect(allIds.size).toBe(3);
  });

  it("only the author can edit / delete", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob, email: bobEmail } = await signUpTestUser("Bob");
    const { teamId, cardId } = await makeCard(alice);
    // Bob must be a team member to even reach the thread (so the rejection is
    // author-only, not access).
    await call(
      teamRouter.addMember,
      { teamId, userId: await userIdByEmail(bobEmail) },
      { context: alice },
    );
    const msg = await sendCardMessage(alice, cardId, "mine");

    await expect(
      call(chatRouter.editMessage, { messageId: msg.id, body: lexicalState("x") }, {
        context: bob,
      }),
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(
      call(chatRouter.deleteMessage, { messageId: msg.id }, { context: bob }),
    ).rejects.toBeInstanceOf(ORPCError);

    await call(
      chatRouter.editMessage,
      { messageId: msg.id, body: lexicalState("edited") },
      { context: alice },
    );
    const { messages } = await openCardRoom(alice, cardId);
    expect(messages[0].editedAt).not.toBeNull();

    await call(chatRouter.deleteMessage, { messageId: msg.id }, {
      context: alice,
    });
    const after = await openCardRoom(alice, cardId);
    expect(after.messages).toHaveLength(0);
  });

  it("toggles a reaction", async () => {
    const { context } = await signUpTestUser("Alice");
    const { cardId } = await makeCard(context);
    const msg = await sendCardMessage(context, cardId, "react me");

    const on = await call(chatRouter.react, { messageId: msg.id, emoji: "🔥" }, {
      context,
    });
    expect(on.added).toBe(true);
    let { messages } = await openCardRoom(context, cardId);
    expect(messages[0].reactions).toEqual([
      { emoji: "🔥", count: 1, reactedByMe: true },
    ]);

    const off = await call(
      chatRouter.react,
      { messageId: msg.id, emoji: "🔥" },
      { context },
    );
    expect(off.added).toBe(false);
    ({ messages } = await openCardRoom(context, cardId));
    expect(messages[0].reactions).toEqual([]);
  });
});

describe("chat.subscribe", () => {
  it("streams created / reaction / deleted for the room only", async () => {
    const { context } = await signUpTestUser();
    const { cardId } = await makeCard(context);
    const { roomId } = await openCardRoom(context, cardId);

    const ac = new AbortController();
    const iter = await call(chatRouter.subscribe, { roomId }, {
      context,
      signal: ac.signal,
    });

    const created = nextWithin(iter, 2000);
    await settle();
    const msg = await call(
      chatRouter.send,
      { roomId, body: lexicalState("hello") },
      { context },
    );
    const ev = await created;
    expect(ev.type).toBe("created");
    expect(ev.type === "created" && ev.message.id).toBe(msg.id);

    const reactionEv = nextWithin(iter, 2000);
    await call(chatRouter.react, { messageId: msg.id, emoji: "👍" }, {
      context,
    });
    const r = await reactionEv;
    expect(r.type).toBe("reaction");

    ac.abort();
    await iter.return?.(undefined);
  });

  it("denies a non-member", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const { cardId } = await makeCard(owner);
    const { roomId } = await openCardRoom(owner, cardId);
    const { context: outsider } = await signUpTestUser("Out");
    const iter = await call(chatRouter.subscribe, { roomId }, {
      context: outsider,
    });
    await expect(iter.next()).rejects.toBeInstanceOf(ORPCError);
  });
});

