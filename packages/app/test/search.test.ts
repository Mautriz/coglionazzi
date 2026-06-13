import { call } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { boardRouter } from "../src/server/orpc/boards";
import { searchRouter } from "../src/server/orpc/search";
import {
  createTestTeam,
  lexicalState,
  sendCardMessage,
  signUpTestUser,
} from "./helpers";
import type { ORPCContext } from "../src/server/orpc/base";

describe("search.global", () => {
  let context: ORPCContext;

  beforeEach(async () => {
    ({ context } = await signUpTestUser());

    const teamId = await createTestTeam(context);
    const { id: boardId } = await call(
      boardRouter.create,
      { teamId, name: "Torneo di scacchi" },
      { context },
    );
    const board = await call(boardRouter.get, { boardId }, { context });
    const columnId = board.columns[0].id;
    const { id: cardId } = await call(
      boardRouter.createCard,
      { columnId, title: "Organizzare il bracket" },
      { context },
    );
    await call(
      boardRouter.updateCard,
      {
        cardId,
        description: lexicalState(
          "Servono otto giocatori per il torneo eliminatorio",
        ),
      },
      { context },
    );
    await sendCardMessage(
      context,
      cardId,
      "io porto la pizza margherita per tutti",
    );
  });

  const search = (query: string) =>
    call(searchRouter.global, { query }, { context });

  it("finds boards by name", async () => {
    const r = await search("scacchi");
    expect(r.boards.map((b) => b.name)).toContain("Torneo di scacchi");
  });

  it("finds cards by title substring", async () => {
    const r = await search("bracket");
    expect(r.cards.map((c) => c.title)).toContain("Organizzare il bracket");
  });

  it("finds cards by description content with a snippet", async () => {
    const r = await search("giocatori");
    const hit = r.cards.find((c) => c.title === "Organizzare il bracket");
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain("giocatori");
    expect(hit!.boardName).toBe("Torneo di scacchi");
  });

  it("finds comments by body content", async () => {
    const r = await search("margherita");
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0].snippet).toContain("margherita");
    expect(r.comments[0].cardTitle).toBe("Organizzare il bracket");
  });

  it("tolerates typos (fuzzy word_similarity)", async () => {
    expect((await search("giocatroi")).cards.length).toBeGreaterThan(0);
    expect((await search("margerita")).comments.length).toBeGreaterThan(0);
  });

  it("does not match lexical structural noise", async () => {
    const r = await search("paragraph");
    expect(r.boards).toHaveLength(0);
    expect(r.cards).toHaveLength(0);
    expect(r.comments).toHaveLength(0);
  });

  it("rejects queries that are too short", async () => {
    await expect(search("a")).rejects.toThrow();
  });
});
