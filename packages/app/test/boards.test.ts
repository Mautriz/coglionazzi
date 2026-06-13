import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { archiveRouter } from "../src/server/orpc/archive";
import { boardRouter } from "../src/server/orpc/boards";
import { commentRouter } from "../src/server/orpc/comments";
import { createTestTeam, lexicalState, signUpTestUser } from "./helpers";

async function makeBoardWithCard(context: Awaited<ReturnType<typeof signUpTestUser>>["context"]) {
  const teamId = await createTestTeam(context);
  const { id: boardId } = await call(
    boardRouter.create,
    { teamId, name: "Test board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  const columnId = board.columns[0].id;
  const { id: cardId } = await call(
    boardRouter.createCard,
    { columnId, title: "A card" },
    { context },
  );
  return { boardId, columnId, cardId, board };
}

describe("board columns", () => {
  it("renames a column", async () => {
    const { context } = await signUpTestUser();
    const { boardId, board } = await makeBoardWithCard(context);
    await call(
      boardRouter.renameColumn,
      { columnId: board.columns[0].id, name: "Backlog" },
      { context },
    );
    const after = await call(boardRouter.get, { boardId }, { context });
    expect(after.columns[0].name).toBe("Backlog");
  });

  it("reorders columns by explicit position", async () => {
    const { context } = await signUpTestUser();
    const { boardId, board } = await makeBoardWithCard(context);
    // Move "Done" before "To do" (position below the first).
    const done = board.columns[2];
    await call(
      boardRouter.moveColumn,
      { columnId: done.id, position: board.columns[0].position - 1 },
      { context },
    );
    const after = await call(boardRouter.get, { boardId }, { context });
    expect(after.columns.map((c) => c.name)).toEqual([
      "Done",
      "To do",
      "Doing",
    ]);
  });

  it("deletes a column but archives its cards (comments kept)", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId, cardId, board } = await makeBoardWithCard(
      context,
    );
    const teamId = board.team_id;
    await call(
      commentRouter.add,
      { entityType: "card", entityId: cardId, body: lexicalState("hi") },
      { context },
    );

    await call(boardRouter.deleteColumn, { columnId }, { context });

    const after = await call(boardRouter.get, { boardId }, { context });
    expect(after.columns.map((c) => c.name)).toEqual(["Doing", "Done"]);

    // The card lives on in the team archive — and its comments survive.
    const archived = await call(archiveRouter.list, { teamId }, { context });
    expect(archived.map((c) => c.id)).toContain(cardId);
    expect(archived.find((c) => c.id === cardId)?.commentCount).toBe(1);
    const kept = Number(
      (
        await db
          .selectFrom("comments")
          .where("entity_type", "=", "card")
          .where("entity_id", "=", cardId)
          .select((eb) => eb.fn.countAll().as("c"))
          .executeTakeFirstOrThrow()
      ).c,
    );
    expect(kept).toBe(1);
  });

  it("a non-member can't rename or delete a column", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { board } = await makeBoardWithCard(alice);
    const columnId = board.columns[0].id;
    await expect(
      call(boardRouter.renameColumn, { columnId, name: "x" }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(boardRouter.deleteColumn, { columnId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
  });
});

describe("boards", () => {
  it("creates a board with the default columns", async () => {
    const { context } = await signUpTestUser();
    const { board } = await makeBoardWithCard(context);
    expect(board.columns.map((c) => c.name)).toEqual([
      "To do",
      "Doing",
      "Done",
    ]);
  });

  it("moveCard with an explicit position reorders within a column", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId, cardId: first } =
      await makeBoardWithCard(context);
    const { id: second } = await call(
      boardRouter.createCard,
      { columnId, title: "B card" },
      { context },
    );

    // Move "B card" before "A card" using a midpoint-style position.
    const board = await call(boardRouter.get, { boardId }, { context });
    const firstPos = board.columns[0].cards.find(
      (c) => c.id === first,
    )!.position;
    await call(
      boardRouter.moveCard,
      { cardId: second, columnId, position: firstPos - 1 },
      { context },
    );

    const after = await call(boardRouter.get, { boardId }, { context });
    expect(after.columns[0].cards.map((c) => c.title)).toEqual([
      "B card",
      "A card",
    ]);
  });

  it("moveCard without a position appends to the target column", async () => {
    const { context } = await signUpTestUser();
    const { boardId, cardId, board } = await makeBoardWithCard(context);
    const doing = board.columns[1];

    await call(
      boardRouter.moveCard,
      { cardId, columnId: doing.id },
      { context },
    );

    const after = await call(boardRouter.get, { boardId }, { context });
    expect(after.columns[0].cards).toHaveLength(0);
    expect(after.columns[1].cards.map((c) => c.id)).toEqual([cardId]);
  });

  it("updateCard persists description and round-trips it as a string", async () => {
    const { context } = await signUpTestUser();
    const { boardId, cardId } = await makeBoardWithCard(context);

    await call(
      boardRouter.updateCard,
      { cardId, description: lexicalState("ciao bello"), tags: ["fun"] },
      { context },
    );

    const board = await call(boardRouter.get, { boardId }, { context });
    const card = board.columns[0].cards[0];
    expect(card.tags).toEqual(["fun"]);
    // jsonb → must come back serialized, ready for the editor's initialState.
    expect(typeof card.description).toBe("string");
    expect(JSON.parse(card.description!).root.children[0].children[0].text).toBe(
      "ciao bello",
    );
  });
});

describe("comments", () => {
  it("adds and lists comments with author names and string bodies", async () => {
    const { context } = await signUpTestUser("Alice");
    const { cardId } = await makeBoardWithCard(context);

    await call(
      commentRouter.add,
      { entityType: "card", entityId: cardId, body: lexicalState("gg") },
      { context },
    );

    const comments = await call(
      commentRouter.list,
      { entityType: "card", entityId: cardId },
      { context },
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe("Alice");
    expect(typeof comments[0].body).toBe("string");
  });

  it("counts comments on board.get cards", async () => {
    const { context } = await signUpTestUser();
    const { boardId, cardId } = await makeBoardWithCard(context);
    for (const t of ["one", "two"]) {
      await call(
        commentRouter.add,
        { entityType: "card", entityId: cardId, body: lexicalState(t) },
        { context },
      );
    }
    const board = await call(boardRouter.get, { boardId }, { context });
    expect(board.columns[0].cards[0].commentCount).toBe(2);
  });

  it("only the author can delete a comment", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { cardId } = await makeBoardWithCard(alice);

    const { id: commentId } = await call(
      commentRouter.add,
      { entityType: "card", entityId: cardId, body: lexicalState("mine") },
      { context: alice },
    );

    await expect(
      call(commentRouter.delete, { commentId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);

    await call(commentRouter.delete, { commentId }, { context: alice });
    const comments = await call(
      commentRouter.list,
      { entityType: "card", entityId: cardId },
      { context: alice },
    );
    expect(comments).toHaveLength(0);
  });

  it("deleteBoard archives its cards into the team archive", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId, cardId, board } = await makeBoardWithCard(
      context,
    );
    const teamId = board.team_id;
    const { id: otherCard } = await call(
      boardRouter.createCard,
      { columnId, title: "other" },
      { context },
    );
    for (const entityId of [cardId, otherCard]) {
      await call(
        commentRouter.add,
        { entityType: "card", entityId, body: lexicalState("hi") },
        { context },
      );
    }

    await call(boardRouter.deleteBoard, { boardId }, { context });

    // Both cards land in the archive (origin detached, column_id null) and
    // their comments are preserved.
    const archived = await call(archiveRouter.list, { teamId }, { context });
    expect(archived.map((c) => c.id).sort()).toEqual(
      [cardId, otherCard].sort(),
    );
    for (const c of archived) {
      expect(c.column_id).toBeNull();
      expect(c.commentCount).toBe(1);
    }
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      call(boardRouter.list, undefined, { context: {} }),
    ).rejects.toThrowError(ORPCError);
  });
});
