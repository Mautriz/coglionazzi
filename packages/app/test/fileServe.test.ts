import { randomUUID } from "node:crypto";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { serveFile } from "../src/server/fileServe";
import { fileService } from "../src/server/files";
import { boardRouter } from "../src/server/orpc/boards";
import { appRouter } from "../src/server/orpc/router";
import type { ORPCContext } from "../src/server/orpc/base";
import { createTestTeam, signUpTestUser } from "./helpers";

const cookieOf = (context: ORPCContext): string =>
  new Headers(context.reqHeaders as HeadersInit).get("cookie") ?? "";

function request(fileId: string | null, cookie?: string): Request {
  const url = fileId
    ? `http://localhost/api/files?fileId=${encodeURIComponent(fileId)}`
    : "http://localhost/api/files";
  return new Request(url, {
    headers: cookie ? { cookie } : {},
  });
}

/** Upload a real (tiny, non-image so sharp stays out of it) file. */
async function upload(context: ORPCContext, name = "notes.txt") {
  const file = new File(["hello world"], name, { type: "text/plain" });
  return call(appRouter.file.upload, { file }, { context });
}

describe("serveFile", () => {
  it("refuses an anonymous request with 401", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);

    const response = await serveFile(request(uploaded.path));

    expect(response.status).toBe(401);
  });

  it("returns 400 when fileId is missing", async () => {
    const { context } = await signUpTestUser("owner");

    const response = await serveFile(request(null, cookieOf(context)));

    expect(response.status).toBe(400);
  });

  it("serves the uploader their own file", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);

    const response = await serveFile(
      request(uploaded.path, cookieOf(context)),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
  });

  it("marks responses private so shared caches never hold them", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);

    const response = await serveFile(
      request(uploaded.path, cookieOf(context)),
    );

    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).not.toContain("public");
  });

  it("gives a stranger 404 for someone else's unattached file", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);

    const { context: strangerCtx } = await signUpTestUser("stranger");

    const response = await serveFile(
      request(uploaded.path, cookieOf(strangerCtx)),
    );

    expect(response.status).toBe(404);
  });

  it("serves a teammate a file attached to a card in their team", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);
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
    await call(
      boardRouter.addAttachment,
      { cardId: card.id, fileId: uploaded.id },
      { context },
    );

    const { context: mateCtx, userId: mate } = await signUpTestUser("mate");
    const { teamRouter } = await import("../src/server/orpc/teams");
    await call(teamRouter.addMember, { teamId, userId: mate }, { context });

    const response = await serveFile(
      request(uploaded.path, cookieOf(mateCtx)),
    );

    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown fileId", async () => {
    const { context } = await signUpTestUser("owner");

    const response = await serveFile(
      request(`${randomUUID()}.txt`, cookieOf(context)),
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when the row exists but the bytes are gone", async () => {
    const { context } = await signUpTestUser("owner");
    const uploaded = await upload(context);
    await fileService.deleteFile(uploaded.path);

    const response = await serveFile(
      request(uploaded.path, cookieOf(context)),
    );

    expect(response.status).toBe(404);
  });
});
