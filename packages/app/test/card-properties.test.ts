import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { boardRouter } from "../src/server/orpc/boards";
import { userRouter } from "../src/server/orpc/users";
import { signUpTestUser } from "./helpers";

type Ctx = Awaited<ReturnType<typeof signUpTestUser>>["context"];

async function makeBoard(context: Ctx) {
  const { id: boardId } = await call(
    boardRouter.create,
    { name: "Props board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  const columnId = board.columns[0].id;
  const card = async (title: string) =>
    (await call(boardRouter.createCard, { columnId, title }, { context })).id;
  return { boardId, columnId, card };
}

const getCard = async (context: Ctx, boardId: string, cardId: string) => {
  const board = await call(boardRouter.get, { boardId }, { context });
  return board.columns
    .flatMap((c) => c.cards)
    .find((c) => c.id === cardId)!;
};

describe("card assignees", () => {
  it("assigns multiple users and replaces the set on update", async () => {
    const { context } = await signUpTestUser("Alice");
    await signUpTestUser("Bob");
    await signUpTestUser("Carol");
    const users = await call(userRouter.list, undefined, { context });

    const { boardId, card } = await makeBoard(context);
    const cardId = await card("Plan party");

    await call(
      boardRouter.updateCard,
      { cardId, assigneeIds: [users[0].id, users[1].id] },
      { context },
    );
    let c = await getCard(context, boardId, cardId);
    expect(c.assignees.map((a) => a.id).sort()).toEqual(
      [users[0].id, users[1].id].sort(),
    );

    // Updating with a new set replaces, not appends.
    await call(
      boardRouter.updateCard,
      { cardId, assigneeIds: [users[2].id] },
      { context },
    );
    c = await getCard(context, boardId, cardId);
    expect(c.assignees.map((a) => a.id)).toEqual([users[2].id]);

    // Empty clears.
    await call(
      boardRouter.updateCard,
      { cardId, assigneeIds: [] },
      { context },
    );
    c = await getCard(context, boardId, cardId);
    expect(c.assignees).toHaveLength(0);
  });

  it("leaves assignees untouched when assigneeIds is omitted", async () => {
    const { context } = await signUpTestUser();
    const users = await call(userRouter.list, undefined, { context });
    const { boardId, card } = await makeBoard(context);
    const cardId = await card("x");

    await call(
      boardRouter.updateCard,
      { cardId, assigneeIds: [users[0].id] },
      { context },
    );
    await call(
      boardRouter.updateCard,
      { cardId, title: "renamed" },
      { context },
    );
    const c = await getCard(context, boardId, cardId);
    expect(c.assignees).toHaveLength(1);
    expect(c.title).toBe("renamed");
  });
});

describe("card relations", () => {
  it("links cards as 'related' (undirected — visible from both sides)", async () => {
    const { context } = await signUpTestUser();
    const { boardId, card } = await makeBoard(context);
    const a = await card("A");
    const b = await card("B");

    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "related" },
      { context },
    );

    const ca = await getCard(context, boardId, a);
    const cb = await getCard(context, boardId, b);
    expect(ca.relations).toEqual([
      { cardId: b, title: "B", kind: "related" },
    ]);
    expect(cb.relations).toEqual([
      { cardId: a, title: "A", kind: "related" },
    ]);
  });

  it("'blocks' reads as blocks for the blocker and blocked_by for the other", async () => {
    const { context } = await signUpTestUser();
    const { boardId, card } = await makeBoard(context);
    const a = await card("A");
    const b = await card("B");

    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "blocks" },
      { context },
    );

    const ca = await getCard(context, boardId, a);
    const cb = await getCard(context, boardId, b);
    expect(ca.relations[0].kind).toBe("blocks");
    expect(cb.relations[0].kind).toBe("blocked_by");
  });

  it("'blocked_by' is stored as the inverse blocks", async () => {
    const { context } = await signUpTestUser();
    const { boardId, card } = await makeBoard(context);
    const a = await card("A");
    const b = await card("B");

    // A is blocked by B.
    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "blocked_by" },
      { context },
    );

    const ca = await getCard(context, boardId, a);
    const cb = await getCard(context, boardId, b);
    expect(ca.relations[0].kind).toBe("blocked_by");
    expect(cb.relations[0].kind).toBe("blocks");
  });

  it("adding a relation replaces any existing one for the pair", async () => {
    const { context } = await signUpTestUser();
    const { boardId, card } = await makeBoard(context);
    const a = await card("A");
    const b = await card("B");

    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "related" },
      { context },
    );
    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "blocks" },
      { context },
    );

    const ca = await getCard(context, boardId, a);
    expect(ca.relations).toHaveLength(1);
    expect(ca.relations[0].kind).toBe("blocks");
  });

  it("removes a relation from either direction", async () => {
    const { context } = await signUpTestUser();
    const { boardId, card } = await makeBoard(context);
    const a = await card("A");
    const b = await card("B");

    await call(
      boardRouter.addRelation,
      { cardId: a, relatedCardId: b, kind: "related" },
      { context },
    );
    // Remove using the opposite direction.
    await call(
      boardRouter.removeRelation,
      { cardId: b, relatedCardId: a },
      { context },
    );

    const ca = await getCard(context, boardId, a);
    expect(ca.relations).toHaveLength(0);
  });

  it("rejects self-relations", async () => {
    const { context } = await signUpTestUser();
    const { card } = await makeBoard(context);
    const a = await card("A");

    await expect(
      call(
        boardRouter.addRelation,
        { cardId: a, relatedCardId: a, kind: "related" },
        { context },
      ),
    ).rejects.toThrowError(ORPCError);
  });
});
