import { randomUUID } from "node:crypto";
import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import {
  assertFileAccess,
  deleteFileIfUnreferenced,
} from "../src/server/fileAccess";
import type { ORPCContext } from "../src/server/orpc/base";
import { boardRouter } from "../src/server/orpc/boards";
import { gameRouter } from "../src/server/orpc/game";
import { teamRouter } from "../src/server/orpc/teams";
import { createTestTeam, signUpTestUser } from "./helpers";

/** Insert a bare file row owned by `owner`; returns `{ id, path }`. */
async function makeFile(owner: string) {
  const path = `${randomUUID()}.webp`;
  const { id } = await db
    .insertInto("files")
    .values({
      path,
      user_id: owner,
      metadata: JSON.stringify({ name: "x.webp", type: "image/webp", size: 1 }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id, path };
}

/** A team + board + column + card owned by the context's user. */
async function makeCard(context: ORPCContext) {
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
  const card = await call(
    boardRouter.createCard,
    { columnId: column.id, title: "T" },
    { context },
  );
  return { teamId, cardId: card.id };
}

/** A deck card referencing `fileId`, owned by the context's user. */
async function makeDeckCard(context: ORPCContext, fileId: string) {
  const deck = await call(gameRouter.decks.create, { name: "D" }, { context });
  await call(
    gameRouter.decks.addCard,
    { deckId: deck.id, fileId, title: "c" },
    { context },
  );
  return deck.id;
}

describe("assertFileAccess", () => {
  it("lets the uploader read a file that is attached to nothing", async () => {
    const { userId } = await signUpTestUser("owner");
    const file = await makeFile(userId);

    await expect(assertFileAccess(userId, file.path)).resolves.toMatchObject({
      id: file.id,
      path: file.path,
    });
  });

  it("refuses a stranger a file that is attached to nothing", async () => {
    const { userId: owner } = await signUpTestUser("owner");
    const file = await makeFile(owner);
    const { userId: stranger } = await signUpTestUser("stranger");

    await expect(assertFileAccess(stranger, file.path)).rejects.toThrow(
      ORPCError,
    );
  });

  it("lets a teammate read a file attached to a card in their team", async () => {
    const { context, userId: owner } = await signUpTestUser("owner");
    const { teamId, cardId } = await makeCard(context);
    const file = await makeFile(owner);
    await call(
      boardRouter.addAttachment,
      { cardId, fileId: file.id },
      { context },
    );

    const { userId: mate } = await signUpTestUser("mate");
    await call(teamRouter.addMember, { teamId, userId: mate }, { context });

    await expect(assertFileAccess(mate, file.path)).resolves.toMatchObject({
      id: file.id,
    });
  });

  it("refuses a non-member a file attached to a card in another team", async () => {
    const { context, userId: owner } = await signUpTestUser("owner");
    const { cardId } = await makeCard(context);
    const file = await makeFile(owner);
    await call(
      boardRouter.addAttachment,
      { cardId, fileId: file.id },
      { context },
    );

    const { userId: outsider } = await signUpTestUser("outsider");

    await expect(assertFileAccess(outsider, file.path)).rejects.toThrow(
      ORPCError,
    );
  });

  it("lets any logged-in user read a game deck image (decks are global)", async () => {
    const { context, userId: owner } = await signUpTestUser("deckowner");
    const file = await makeFile(owner);
    await makeDeckCard(context, file.id);

    const { userId: stranger } = await signUpTestUser("stranger");

    await expect(assertFileAccess(stranger, file.path)).resolves.toMatchObject({
      id: file.id,
    });
  });

  it("throws NOT_FOUND for an unknown path", async () => {
    const { userId } = await signUpTestUser("owner");

    await expect(
      assertFileAccess(userId, `${randomUUID()}.webp`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides denial behind NOT_FOUND rather than FORBIDDEN", async () => {
    const { userId: owner } = await signUpTestUser("owner");
    const file = await makeFile(owner);
    const { userId: stranger } = await signUpTestUser("stranger");

    await expect(assertFileAccess(stranger, file.path)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deleteFileIfUnreferenced", () => {
  it("deletes the row when nothing references the file", async () => {
    const { userId } = await signUpTestUser("owner");
    const file = await makeFile(userId);

    await expect(deleteFileIfUnreferenced(file.id)).resolves.toBe(true);

    const row = await db
      .selectFrom("files")
      .where("id", "=", file.id)
      .select("id")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("keeps the file while a card still references it", async () => {
    const { context, userId } = await signUpTestUser("owner");
    const { cardId } = await makeCard(context);
    const file = await makeFile(userId);
    await call(
      boardRouter.addAttachment,
      { cardId, fileId: file.id },
      { context },
    );

    await expect(deleteFileIfUnreferenced(file.id)).resolves.toBe(false);

    const row = await db
      .selectFrom("files")
      .where("id", "=", file.id)
      .select("id")
      .executeTakeFirst();
    expect(row?.id).toBe(file.id);
  });

  it("keeps the file while a deck card still references it", async () => {
    const { context, userId } = await signUpTestUser("owner");
    const file = await makeFile(userId);
    await makeDeckCard(context, file.id);

    await expect(deleteFileIfUnreferenced(file.id)).resolves.toBe(false);
  });
});
