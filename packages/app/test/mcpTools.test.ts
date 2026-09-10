import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { ORPCContext } from "../src/server/orpc/base";
import { boardRouter } from "../src/server/orpc/boards";
import { appRouter } from "../src/server/orpc/router";
import { toolByName, type ToolCtx, type ToolResult } from "../src/server/mcp/tools";
import { createTestTeam, signUpTestUser } from "./helpers";

/** Run a tool the way the MCP server would. */
async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<ToolResult> {
  const tool = toolByName(name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool.handler(input as never, ctx);
}

const textOf = (result: ToolResult): string =>
  result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

async function setup(name = "owner") {
  const { context, userId } = await signUpTestUser(name);
  const ctx: ToolCtx = { context, userId };
  const teamId = await createTestTeam(context, "Coglionazzi");
  const board = await call(
    boardRouter.create,
    { name: "Insacco", teamId },
    { context },
  );
  const column = await call(
    boardRouter.addColumn,
    { boardId: board.id, name: "Todo" },
    { context },
  );
  return { context, userId, ctx, teamId, boardId: board.id, columnId: column.id };
}

describe("discovery tools", () => {
  it("lists the caller's teams with their ids", async () => {
    const { ctx, teamId } = await setup();

    const out = textOf(await runTool("list_teams", {}, ctx));

    expect(out).toContain("Coglionazzi");
    expect(out).toContain(teamId);
  });

  it("lists boards", async () => {
    const { ctx, boardId } = await setup();

    const out = textOf(await runTool("list_boards", {}, ctx));

    expect(out).toContain("Insacco");
    expect(out).toContain(boardId);
  });

  it("narrows boards to one team", async () => {
    const { ctx, context } = await setup();
    const otherTeam = await createTestTeam(context, "Other");
    await call(
      boardRouter.create,
      { name: "Elsewhere", teamId: otherTeam },
      { context },
    );

    const out = textOf(await runTool("list_boards", { teamId: otherTeam }, ctx));

    expect(out).toContain("Elsewhere");
    expect(out).not.toContain("Insacco");
  });

  it("shows a board's columns and their tasks", async () => {
    const { ctx, boardId, columnId, context } = await setup();
    await call(
      boardRouter.createCard,
      { columnId, title: "Write the thing" },
      { context },
    );

    const out = textOf(await runTool("get_board", { boardId }, ctx));

    expect(out).toContain("Todo");
    expect(out).toContain("Write the thing");
  });

  it("lists team members with the ids update_task expects", async () => {
    const { ctx, teamId, userId } = await setup();

    const out = textOf(await runTool("list_team_members", { teamId }, ctx));

    expect(out).toContain(userId);
  });
});

describe("get_task", () => {
  it("returns the task with its comments in one call", async () => {
    const { ctx, columnId, context } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Fix autosave" },
      { context },
    );
    await runTool(
      "comment_task",
      { taskId: card.id, body: "It double-fires on blur." },
      ctx,
    );

    const out = textOf(await runTool("get_task", { taskId: card.id }, ctx));

    expect(out).toContain("Fix autosave");
    expect(out).toContain("It double-fires on blur.");
  });

  it("lists attachments with the id get_attachment takes", async () => {
    const { ctx, columnId, context } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "T" },
      { context },
    );
    const uploaded = await call(
      appRouter.file.upload,
      { file: new File(["spec body"], "spec.txt", { type: "text/plain" }) },
      { context },
    );
    await call(
      boardRouter.addAttachment,
      { cardId: card.id, fileId: uploaded.id },
      { context },
    );

    const out = textOf(await runTool("get_task", { taskId: card.id }, ctx));

    expect(out).toContain("spec.txt");
    expect(out).toContain(uploaded.path);
  });

  it("refuses a task in a team the caller is not in", async () => {
    const { columnId, context } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Secret" },
      { context },
    );

    const { context: outsiderCtx, userId: outsider } =
      await signUpTestUser("outsider");

    await expect(
      runTool(
        "get_task",
        { taskId: card.id },
        { context: outsiderCtx, userId: outsider },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("get_attachment", () => {
  it("returns a text attachment as readable text", async () => {
    const { ctx, context } = await setup();
    const uploaded = await call(
      appRouter.file.upload,
      { file: new File(["the spec body"], "spec.txt", { type: "text/plain" }) },
      { context },
    );

    const result = await runTool(
      "get_attachment",
      { attachmentId: uploaded.path },
      ctx,
    );

    expect(textOf(result)).toContain("the spec body");
  });

  it("refuses an attachment the caller cannot see", async () => {
    const { context } = await setup();
    const uploaded = await call(
      appRouter.file.upload,
      { file: new File(["secret"], "s.txt", { type: "text/plain" }) },
      { context },
    );

    const { context: outsiderCtx, userId: outsider } =
      await signUpTestUser("outsider");

    await expect(
      runTool(
        "get_attachment",
        { attachmentId: uploaded.path },
        { context: outsiderCtx, userId: outsider },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("write tools", () => {
  it("creates a task with a description", async () => {
    const { ctx, columnId, boardId } = await setup();

    const created = await runTool(
      "create_task",
      { columnId, title: "New task", description: "Do the thing properly." },
      ctx,
    );

    expect(textOf(created)).toContain("Created task");

    const board = textOf(await runTool("get_board", { boardId }, ctx));
    expect(board).toContain("New task");
  });

  it("stores a plain-text description so get_task reads it back", async () => {
    const { ctx, columnId } = await setup();
    await runTool(
      "create_task",
      { columnId, title: "Described", description: "Body from a bot." },
      ctx,
    );

    const found = textOf(await runTool("search", { query: "Described" }, ctx));
    const taskId = found.match(/`([0-9a-f-]{36})`/)?.[1];
    expect(taskId).toBeDefined();

    const out = textOf(await runTool("get_task", { taskId }, ctx));
    expect(out).toContain("Body from a bot.");
  });

  it("moves a task to another column", async () => {
    const { ctx, context, boardId, columnId } = await setup();
    const done = await call(
      boardRouter.addColumn,
      { boardId, name: "Done" },
      { context },
    );
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Movable" },
      { context },
    );

    await runTool("update_task", { taskId: card.id, columnId: done.id }, ctx);

    const out = textOf(await runTool("get_task", { taskId: card.id }, ctx));
    expect(out).toContain("Done");
  });

  it("assigns a task to a team member", async () => {
    const { ctx, context, columnId, userId } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Assignable" },
      { context },
    );

    await runTool(
      "update_task",
      { taskId: card.id, assigneeIds: [userId] },
      ctx,
    );

    const out = textOf(await runTool("get_task", { taskId: card.id }, ctx));
    expect(out).toMatch(/Assignees: (?!nobody)/);
  });

  it("sets tags", async () => {
    const { ctx, context, columnId } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Taggable" },
      { context },
    );

    await runTool("update_task", { taskId: card.id, tags: ["bug"] }, ctx);

    expect(textOf(await runTool("get_task", { taskId: card.id }, ctx))).toContain(
      "bug",
    );
  });

  it("archives a task", async () => {
    const { ctx, context, columnId } = await setup();
    const card = await call(
      boardRouter.createCard,
      { columnId, title: "Doomed" },
      { context },
    );

    await runTool("archive_task", { taskId: card.id }, ctx);

    const out = textOf(await runTool("get_task", { taskId: card.id }, ctx));
    expect(out).toMatch(/archived/i);
  });

  it("refuses to write to a team the caller is not in", async () => {
    const { columnId } = await setup();
    const { context: outsiderCtx, userId: outsider } =
      await signUpTestUser("outsider");

    await expect(
      runTool(
        "create_task",
        { columnId, title: "Intruder" },
        { context: outsiderCtx, userId: outsider },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("search tool", () => {
  it("finds a task by a typo'd title", async () => {
    const { ctx, columnId, context } = await setup();
    await call(
      boardRouter.createCard,
      { columnId, title: "Birra artigianale" },
      { context },
    );

    const out = textOf(await runTool("search", { query: "artigianale" }, ctx));

    expect(out).toContain("Birra artigianale");
  });
});
