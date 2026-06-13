import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { boardRouter } from "../src/server/orpc/boards";
import { createTestTeam, signUpTestUser } from "./helpers";

type Ctx = Awaited<ReturnType<typeof signUpTestUser>>["context"];

/** Create a board in a fresh team; returns ids + a tagged-card helper. */
async function makeBoard(context: Ctx, teamName = "Tag team") {
  const teamId = await createTestTeam(context, teamName);
  const { id: boardId } = await call(
    boardRouter.create,
    { teamId, name: "Tag board" },
    { context },
  );
  const board = await call(boardRouter.get, { boardId }, { context });
  const columnId = board.columns[0].id;
  /** Create a card carrying the given tags; returns its id. */
  const card = async (title: string, tags: string[] = []) => {
    const { id } = await call(
      boardRouter.createCard,
      { columnId, title },
      { context },
    );
    if (tags.length) {
      await call(boardRouter.updateCard, { cardId: id, tags }, { context });
    }
    return id;
  };
  return { teamId, boardId, columnId, card };
}

describe("board.teamTags", () => {
  it("returns distinct tags across the team's boards, sorted", async () => {
    const { context } = await signUpTestUser("Alice");
    const { teamId, columnId, card } = await makeBoard(context);
    await card("c1", ["zebra", "apple"]);
    await card("c2", ["apple", "mango"]); // apple repeats

    // A second board in the SAME team contributes its tags too.
    const { id: boardId2 } = await call(
      boardRouter.create,
      { teamId, name: "Board 2" },
      { context },
    );
    const board2 = await call(boardRouter.get, { boardId: boardId2 }, { context });
    const { id: c3 } = await call(
      boardRouter.createCard,
      { columnId: board2.columns[0].id, title: "c3" },
      { context },
    );
    await call(boardRouter.updateCard, { cardId: c3, tags: ["banana"] }, { context });

    const tags = await call(boardRouter.teamTags, { teamId }, { context });
    expect(tags).toEqual(["apple", "banana", "mango", "zebra"]);
    expect(columnId).toBeTruthy();
  });

  it("excludes tags that appear only on archived cards", async () => {
    const { context } = await signUpTestUser("Bob");
    const { teamId, card } = await makeBoard(context);
    await card("live", ["keep"]);
    const archived = await card("old", ["gone", "keep"]);
    await call(boardRouter.archiveCard, { cardId: archived }, { context });

    const tags = await call(boardRouter.teamTags, { teamId }, { context });
    // "keep" survives (also on a live card); "gone" is only on the archived one.
    expect(tags).toEqual(["keep"]);
  });

  it("returns an empty list when no card has tags", async () => {
    const { context } = await signUpTestUser("Carol");
    const { teamId, card } = await makeBoard(context);
    await card("untagged");

    const tags = await call(boardRouter.teamTags, { teamId }, { context });
    expect(tags).toEqual([]);
  });

  it("is team-gated: a non-member cannot read the team's tags", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const { teamId, card } = await makeBoard(owner);
    await card("c", ["secret"]);

    const { context: outsider } = await signUpTestUser("Outsider");
    await expect(
      call(boardRouter.teamTags, { teamId }, { context: outsider }),
    ).rejects.toThrowError(ORPCError);
  });
});
