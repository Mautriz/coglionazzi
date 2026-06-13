import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { boardRouter } from "../src/server/orpc/boards";
import { presenceRouter } from "../src/server/orpc/presence";
import { teamRouter } from "../src/server/orpc/teams";
import type { ORPCContext } from "../src/server/orpc/base";
import { createTestTeam, signUpTestUser } from "./helpers";

async function userIdByEmail(email: string): Promise<string> {
  const row = await db
    .selectFrom("users")
    .where("email", "=", email)
    .select("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

type Ctx = ORPCContext;

async function makeBoard(context: Ctx) {
  const teamId = await createTestTeam(context);
  const { id: boardId } = await call(
    boardRouter.create,
    { teamId, name: "Realtime board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  return { teamId, boardId, columnId: board.columns[0].id };
}

/** Drive an async iterator's next() but reject if nothing arrives in time. */
function nextWithin<T>(iter: AsyncIterator<T>, ms: number): Promise<T> {
  return Promise.race([
    iter.next().then((r) => r.value as T),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("no event within timeout")), ms),
    ),
  ]);
}

/** Assert the iterator stays idle (yields nothing) for the window. */
async function expectIdle(iter: AsyncIterator<unknown>, ms: number) {
  const outcome = await Promise.race([
    iter.next().then(() => "event" as const),
    new Promise<"idle">((res) => setTimeout(() => res("idle"), ms)),
  ]);
  expect(outcome).toBe("idle");
}

/** Let a freshly-started subscription reach its publisher.subscribe loop
 *  (after its async access check) before we publish, avoiding a race. */
const settle = () => new Promise((r) => setTimeout(r, 40));

describe("board.subscribe", () => {
  it("yields when the subscribed board changes", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId } = await makeBoard(context);

    const ac = new AbortController();
    const iter = await call(
      boardRouter.subscribe,
      { boardId },
      { context, signal: ac.signal },
    );
    const pending = nextWithin(iter, 2000);
    await settle();

    await call(boardRouter.createCard, { columnId, title: "x" }, { context });

    expect(await pending).toEqual({ boardId });
    ac.abort();
    await iter.return?.(undefined);
  });

  it("ignores changes to a different board", async () => {
    const { context } = await signUpTestUser();
    const a = await makeBoard(context);
    const b = await makeBoard(context);

    const ac = new AbortController();
    const iter = await call(
      boardRouter.subscribe,
      { boardId: a.boardId },
      { context, signal: ac.signal },
    );
    // Start consuming, then change the OTHER board: must stay idle.
    await settle();
    await call(
      boardRouter.createCard,
      { columnId: b.columnId, title: "other" },
      { context },
    );
    await expectIdle(iter, 200);

    ac.abort();
    await iter.return?.(undefined);
  });

  it("denies a non-member", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const { boardId } = await makeBoard(owner);
    const { context: outsider } = await signUpTestUser("Outsider");

    const iter = await call(
      boardRouter.subscribe,
      { boardId },
      { context: outsider },
    );
    await expect(iter.next()).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("team.subscribe", () => {
  it("notifies a member when a board is added to their team", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);

    const ac = new AbortController();
    const iter = await call(teamRouter.subscribe, undefined, {
      context,
      signal: ac.signal,
    });
    const pending = nextWithin(iter, 2000);
    await settle();

    await call(boardRouter.create, { teamId, name: "B" }, { context });

    expect(await pending).toEqual({ teamId });
    ac.abort();
    await iter.return?.(undefined);
  });

  it("notifies a removed member even though they're no longer in the team", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { context: member, email } = await signUpTestUser("Member");
    const memberId = await userIdByEmail(email);
    await call(teamRouter.addMember, { teamId, userId: memberId }, {
      context: owner,
    });

    const ac = new AbortController();
    const iter = await call(teamRouter.subscribe, undefined, {
      context: member,
      signal: ac.signal,
    });
    const pending = nextWithin(iter, 2000);
    await settle();

    // The removed member matches via affectedUserIds, not membership.
    await call(teamRouter.removeMember, { teamId, userId: memberId }, {
      context: owner,
    });

    expect(await pending).toEqual({ teamId });
    ac.abort();
    await iter.return?.(undefined);
  });

  it("does not notify a non-member", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { context: outsider } = await signUpTestUser("Outsider");

    const ac = new AbortController();
    const iter = await call(teamRouter.subscribe, undefined, {
      context: outsider,
      signal: ac.signal,
    });
    const idle = expectIdle(iter, 250);
    await settle();

    await call(boardRouter.create, { teamId, name: "B" }, { context: owner });

    await idle;
    ac.abort();
    await iter.return?.(undefined);
  });
});

describe("presence.subscribe", () => {
  it("yields the current roster immediately and on join", async () => {
    const { context: a } = await signUpTestUser("Aaa");
    const { boardId, teamId } = await makeBoard(a);

    const acA = new AbortController();
    const iterA = await call(
      presenceRouter.subscribe,
      { boardId },
      { context: a, signal: acA.signal },
    );
    // First yield is the snapshot — A is viewing.
    const first = await nextWithin(iterA, 2000);
    expect(first.map((v) => v.name)).toEqual(["Aaa"]);

    // A second member starts viewing → A sees the updated roster.
    const { context: b, email } = await signUpTestUser("Bbb");
    await call(
      teamRouter.addMember,
      { teamId, userId: await userIdByEmail(email) },
      { context: a },
    );
    const pending = nextWithin(iterA, 2000);
    await settle();
    const acB = new AbortController();
    const iterB = await call(
      presenceRouter.subscribe,
      { boardId },
      { context: b, signal: acB.signal },
    );
    // Driving B's first next() runs its body (joinPresence), which is what
    // notifies A — a generator procedure doesn't run until iterated.
    const firstB = nextWithin(iterB, 2000);

    const roster = await pending;
    await firstB;
    expect(roster.map((v) => v.name).sort()).toEqual(["Aaa", "Bbb"]);

    acA.abort();
    acB.abort();
    await iterA.return?.(undefined);
    await iterB.return?.(undefined);
  });
});
