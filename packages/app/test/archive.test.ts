import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { archiveRouter } from "../src/server/orpc/archive";
import { boardRouter } from "../src/server/orpc/boards";
import { commentRouter } from "../src/server/orpc/comments";
import { searchRouter } from "../src/server/orpc/search";
import type { ORPCContext } from "../src/server/orpc/base";
import { createTestTeam, lexicalState, signUpTestUser } from "./helpers";

/** A team with a board, its first column, and a card in it. */
async function setup(context: ORPCContext) {
  const teamId = await createTestTeam(context);
  const { id: boardId } = await call(
    boardRouter.create,
    { teamId, name: "Board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  const columnId = board.columns[0].id;
  const { id: cardId } = await call(
    boardRouter.createCard,
    { columnId, title: "A card" },
    { context },
  );
  return { teamId, boardId, columnId, cardId };
}

describe("archive", () => {
  it("archiveCard hides the card from the board and lists it in the archive", async () => {
    const { context } = await signUpTestUser();
    const { teamId, boardId, cardId } = await setup(context);

    await call(boardRouter.archiveCard, { cardId }, { context });

    const board = await call(boardRouter.get, { boardId }, { context });
    expect(board.columns.flatMap((c) => c.cards)).toHaveLength(0);

    const archived = await call(archiveRouter.list, { teamId }, { context });
    expect(archived.map((c) => c.id)).toEqual([cardId]);
    expect(archived[0].archived_origin).toBe("Board / To do");
  });

  it("excludes archived cards from global search", async () => {
    const { context } = await signUpTestUser();
    const { cardId } = await setup(context);
    await call(
      boardRouter.updateCard,
      { cardId, title: "findme unique" },
      { context },
    );

    const before = await call(
      searchRouter.global,
      { query: "findme" },
      { context },
    );
    expect(before.cards.map((c) => c.id)).toContain(cardId);

    await call(boardRouter.archiveCard, { cardId }, { context });
    const after = await call(
      searchRouter.global,
      { query: "findme" },
      { context },
    );
    expect(after.cards.map((c) => c.id)).not.toContain(cardId);
  });

  it("restores a card into its original column when it still exists", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId, cardId } = await setup(context);
    await call(boardRouter.archiveCard, { cardId }, { context });

    await call(archiveRouter.restore, { cardId }, { context });

    const board = await call(boardRouter.get, { boardId }, { context });
    const restored = board.columns
      .find((c) => c.id === columnId)!
      .cards.find((c) => c.id === cardId);
    expect(restored).toBeDefined();
  });

  it("requires a destination when the original board is gone", async () => {
    const { context } = await signUpTestUser();
    const { teamId, boardId, cardId } = await setup(context);
    // A second board to restore into.
    const { id: otherBoardId } = await call(
      boardRouter.create,
      { teamId, name: "Other" },
      { context },
    );
    const other = await call(
      boardRouter.get,
      { boardId: otherBoardId },
      { context },
    );

    // Deleting the board archives the card and detaches its column.
    await call(boardRouter.deleteBoard, { boardId }, { context });
    const archived = await call(archiveRouter.list, { teamId }, { context });
    expect(archived.find((c) => c.id === cardId)?.column_id).toBeNull();

    // No destination → rejected.
    await expect(
      call(archiveRouter.restore, { cardId }, { context }),
    ).rejects.toThrowError(ORPCError);

    // With a destination in the same team → restored there.
    const destColumn = other.columns[0].id;
    await call(
      archiveRouter.restore,
      { cardId, destinationColumnId: destColumn },
      { context },
    );
    const after = await call(
      boardRouter.get,
      { boardId: otherBoardId },
      { context },
    );
    expect(
      after.columns.find((c) => c.id === destColumn)!.cards.map((c) => c.id),
    ).toContain(cardId);
  });

  it("can't restore into another team's board", async () => {
    const { context } = await signUpTestUser();
    const { boardId, cardId } = await setup(context);
    // The same user owns a second, separate team with a board.
    const otherTeam = await createTestTeam(context, "Other team");
    const { id: otherBoardId } = await call(
      boardRouter.create,
      { teamId: otherTeam, name: "Foreign" },
      { context },
    );
    const foreign = await call(
      boardRouter.get,
      { boardId: otherBoardId },
      { context },
    );

    await call(boardRouter.deleteBoard, { boardId }, { context });
    await expect(
      call(
        archiveRouter.restore,
        { cardId, destinationColumnId: foreign.columns[0].id },
        { context },
      ),
    ).rejects.toThrowError(ORPCError);
  });

  it("purges an archived card and its comments", async () => {
    const { context } = await signUpTestUser();
    const { teamId, cardId } = await setup(context);
    await call(
      commentRouter.add,
      { entityType: "card", entityId: cardId, body: lexicalState("bye") },
      { context },
    );
    await call(boardRouter.archiveCard, { cardId }, { context });

    await call(archiveRouter.purge, { cardId }, { context });

    const archived = await call(archiveRouter.list, { teamId }, { context });
    expect(archived).toHaveLength(0);
    const cards = await db
      .selectFrom("cards")
      .where("id", "=", cardId)
      .selectAll()
      .execute();
    expect(cards).toHaveLength(0);
    const comments = await db
      .selectFrom("comments")
      .where("entity_type", "=", "card")
      .where("entity_id", "=", cardId)
      .selectAll()
      .execute();
    expect(comments).toHaveLength(0);
  });

  it("refuses to purge a live (non-archived) card", async () => {
    const { context } = await signUpTestUser();
    const { cardId } = await setup(context);
    await expect(
      call(archiveRouter.purge, { cardId }, { context }),
    ).rejects.toThrowError(ORPCError);
  });

  it("scopes the archive to team members", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { teamId, cardId } = await setup(alice);
    await call(boardRouter.archiveCard, { cardId }, { context: alice });

    await expect(
      call(archiveRouter.list, { teamId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(archiveRouter.restore, { cardId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(archiveRouter.purge, { cardId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
  });

  it("hides archived counterparts from a live card's relations", async () => {
    const { context } = await signUpTestUser();
    const { boardId, columnId, cardId } = await setup(context);
    const { id: otherCard } = await call(
      boardRouter.createCard,
      { columnId, title: "other" },
      { context },
    );
    await call(
      boardRouter.addRelation,
      { cardId, relatedCardId: otherCard, kind: "related" },
      { context },
    );

    // Archiving the counterpart drops the relation from the live card's view.
    await call(boardRouter.archiveCard, { cardId: otherCard }, { context });
    const board = await call(boardRouter.get, { boardId }, { context });
    const live = board.columns
      .flatMap((c) => c.cards)
      .find((c) => c.id === cardId);
    expect(live?.relations).toHaveLength(0);
  });
});
