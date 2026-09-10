import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { fileService } from "../src/server/files";
import { archiveRouter } from "../src/server/orpc/archive";
import type { ORPCContext } from "../src/server/orpc/base";
import { boardRouter } from "../src/server/orpc/boards";
import { gameRouter } from "../src/server/orpc/game";
import { appRouter } from "../src/server/orpc/router";
import { createTestTeam, signUpTestUser } from "./helpers";

async function upload(context: ORPCContext, name = "notes.txt") {
  const file = new File(["hello"], name, { type: "text/plain" });
  return call(appRouter.file.upload, { file }, { context });
}

const fileRow = (id: string) =>
  db.selectFrom("files").where("id", "=", id).select("id").executeTakeFirst();

/** Team + board + column, ready for cards. */
async function makeBoard(context: ORPCContext) {
  const teamId = await createTestTeam(context);
  const board = await call(
    boardRouter.create,
    { name: "B", teamId },
    { context },
  );
  const column = await call(
    boardRouter.addColumn,
    { boardId: board.id, name: "C" },
    { context },
  );
  return { teamId, boardId: board.id, columnId: column.id };
}

async function makeCard(context: ORPCContext, columnId: string, title = "T") {
  const card = await call(
    boardRouter.createCard,
    { columnId, title },
    { context },
  );
  return card.id;
}

describe("attachment removal collects the file", () => {
  it("deletes the file once its last card reference goes", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const cardId = await makeCard(context, columnId);
    const uploaded = await upload(context);
    await call(
      boardRouter.addAttachment,
      { cardId, fileId: uploaded.id },
      { context },
    );

    await call(
      boardRouter.removeAttachment,
      { cardId, fileId: uploaded.id },
      { context },
    );

    expect(await fileRow(uploaded.id)).toBeUndefined();
    expect(await fileService.exists(uploaded.path)).toBe(false);
  });

  it("keeps the file while another card still uses it", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const first = await makeCard(context, columnId, "first");
    const second = await makeCard(context, columnId, "second");
    const uploaded = await upload(context);
    await call(
      boardRouter.addAttachment,
      { cardId: first, fileId: uploaded.id },
      { context },
    );
    await call(
      boardRouter.addAttachment,
      { cardId: second, fileId: uploaded.id },
      { context },
    );

    await call(
      boardRouter.removeAttachment,
      { cardId: first, fileId: uploaded.id },
      { context },
    );

    expect(await fileRow(uploaded.id)).toBeDefined();
    expect(await fileService.exists(uploaded.path)).toBe(true);
  });
});

describe("archive.purge collects attachments", () => {
  it("deletes the purged card's attachment files", async () => {
    const { context } = await signUpTestUser("owner");
    const { columnId } = await makeBoard(context);
    const cardId = await makeCard(context, columnId);
    const uploaded = await upload(context);
    await call(
      boardRouter.addAttachment,
      { cardId, fileId: uploaded.id },
      { context },
    );
    await call(boardRouter.archiveCard, { cardId }, { context });

    await call(archiveRouter.purge, { cardId }, { context });

    expect(await fileRow(uploaded.id)).toBeUndefined();
    expect(await fileService.exists(uploaded.path)).toBe(false);
  });
});

describe("deck cards collect their images", () => {
  it("deletes the image when a deck card is removed", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context, "card.txt");
    const deck = await call(
      gameRouter.decks.create,
      { name: "D" },
      { context },
    );
    const card = await call(
      gameRouter.decks.addCard,
      { deckId: deck.id, fileId: uploaded.id, title: "c" },
      { context },
    );

    await call(gameRouter.decks.removeCard, { cardId: card.id }, { context });

    expect(await fileRow(uploaded.id)).toBeUndefined();
  });

  it("deletes a deleted deck's images", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context, "card.txt");
    const deck = await call(
      gameRouter.decks.create,
      { name: "D" },
      { context },
    );
    await call(
      gameRouter.decks.addCard,
      { deckId: deck.id, fileId: uploaded.id, title: "c" },
      { context },
    );

    await call(gameRouter.decks.delete, { deckId: deck.id }, { context });

    expect(await fileRow(uploaded.id)).toBeUndefined();
  });

  it("keeps images a clone still references when the original deck goes", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context, "card.txt");
    const deck = await call(
      gameRouter.decks.create,
      { name: "D" },
      { context },
    );
    await call(
      gameRouter.decks.addCard,
      { deckId: deck.id, fileId: uploaded.id, title: "c" },
      { context },
    );
    // Clones deliberately reference the SAME files.
    await call(gameRouter.decks.clone, { deckId: deck.id }, { context });

    await call(gameRouter.decks.delete, { deckId: deck.id }, { context });

    expect(await fileRow(uploaded.id)).toBeDefined();
    expect(await fileService.exists(uploaded.path)).toBe(true);
  });
});
