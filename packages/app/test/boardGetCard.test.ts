import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { ORPCContext } from "../src/server/orpc/base";
import { boardRouter } from "../src/server/orpc/boards";
import { appRouter } from "../src/server/orpc/router";
import { teamRouter } from "../src/server/orpc/teams";
import { createTestTeam, lexicalState, signUpTestUser } from "./helpers";

async function makeBoard(context: ORPCContext) {
  const teamId = await createTestTeam(context);
  const board = await call(
    boardRouter.create,
    { name: "Board", teamId },
    { context },
  );
  const column = await call(
    boardRouter.addColumn,
    { boardId: board.id, name: "Todo" },
    { context },
  );
  return { teamId, boardId: board.id, columnId: column.id };
}

describe("board.getCard", () => {
  it("returns a single card without loading its whole board", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "Fix autosave" },
      { context },
    );

    const card = await call(
      boardRouter.getCard,
      { cardId: created.id },
      { context },
    );

    expect(card.title).toBe("Fix autosave");
  });

  it("names the board and column the card sits in", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "T" },
      { context },
    );

    const card = await call(
      boardRouter.getCard,
      { cardId: created.id },
      { context },
    );

    expect(card.boardName).toBe("Board");
    expect(card.columnName).toBe("Todo");
  });

  it("carries the nested extras the board view builds", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "T" },
      { context },
    );
    // createCard takes only a title — the body is a separate update.
    await call(
      boardRouter.updateCard,
      { cardId: created.id, description: lexicalState("body text") },
      { context },
    );
    const uploaded = await call(
      appRouter.file.upload,
      { file: new File(["x"], "spec.txt", { type: "text/plain" }) },
      { context },
    );
    await call(
      boardRouter.addAttachment,
      { cardId: created.id, fileId: uploaded.id },
      { context },
    );

    const card = await call(
      boardRouter.getCard,
      { cardId: created.id },
      { context },
    );

    expect(card.attachments).toHaveLength(1);
    expect(card.assignees).toEqual([]);
    expect(card.relations).toEqual([]);
    expect(card.description_text).toContain("body text");
  });

  it("refuses a card in a team the caller does not belong to", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "T" },
      { context },
    );

    const { context: outsiderCtx } = await signUpTestUser("outsider");

    await expect(
      call(boardRouter.getCard, { cardId: created.id }, { context: outsiderCtx }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serves a teammate the same card", async () => {
    const { context } = await signUpTestUser("owner");
    const { teamId, columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "T" },
      { context },
    );

    const { context: mateCtx, userId: mate } = await signUpTestUser("mate");
    await call(teamRouter.addMember, { teamId, userId: mate }, { context });

    const card = await call(
      boardRouter.getCard,
      { cardId: created.id },
      { context: mateCtx },
    );

    expect(card.id).toBe(created.id);
  });

  it("still resolves an archived card whose column is gone", async () => {
    const { context } = await signUpTestUser("owner");
    const { boardId, columnId } = await makeBoard(context);
    const created = await call(
      boardRouter.createCard,
      { columnId, title: "Orphan" },
      { context },
    );
    await call(boardRouter.deleteColumn, { columnId }, { context });

    const card = await call(
      boardRouter.getCard,
      { cardId: created.id },
      { context },
    );

    expect(card.title).toBe("Orphan");
    expect(card.archived_at).not.toBeNull();
    // The origin label survives the column it came from.
    expect(card.archived_origin).toContain("Board");
    expect(boardId).toBeDefined();
  });
});
