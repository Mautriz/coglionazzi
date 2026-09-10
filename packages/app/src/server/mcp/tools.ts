import { call } from "@orpc/server";
import { z } from "zod";
import { assertFileAccess } from "../fileAccess";
import { fileService } from "../files";
import { extractLexicalText, plainTextToLexical } from "../lexicalText";
import type { ORPCContext } from "../orpc/base";
import { appRouter } from "../orpc/router";
import { renderTask, renderTaskLine, type TaskComment } from "./render";

/** MCP content blocks we emit. Text for everything readable; image blocks so a
 *  screenshot actually reaches the model's vision rather than as a link. */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** What a tool handler is given. `context` is the caller's oRPC context — the
 *  same one an HTTP request carries — so every procedure it calls is
 *  access-gated exactly as it is for the browser. `userId` is the resolved
 *  caller, for the few gates (file access) that take a user id directly. */
export interface ToolCtx {
  context: ORPCContext;
  userId: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: never, ctx: ToolCtx) => Promise<ToolResult>;
}

const text = (body: string): ToolResult => ({
  content: [{ type: "text", text: body }],
});

/** Attachments larger than this aren't worth pushing through a tool result. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function define<S extends z.ZodRawShape>(tool: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  handler: (
    input: z.infer<z.ZodObject<S>>,
    ctx: ToolCtx,
  ) => Promise<ToolResult>;
}): ToolDef {
  return tool as unknown as ToolDef;
}

const listTeams = define({
  name: "list_teams",
  title: "List teams",
  description:
    "List the teams you belong to. Every board, task and chat lives in a team; start here when you don't know which team a task is in.",
  inputSchema: {},
  handler: async (_input, { context }) => {
    const teams = await call(appRouter.team.list, undefined, { context });
    if (teams.length === 0) return text("You are not a member of any team.");

    return text(
      [
        "# Teams",
        ...teams.map(
          (team) =>
            `- \`${team.id}\` · ${team.name} (${team.boardCount} boards, ${team.memberCount} members)`,
        ),
      ].join("\n"),
    );
  },
});

const listBoards = define({
  name: "list_boards",
  title: "List boards",
  description:
    "List the boards you can see, optionally narrowed to one team. Boards hold the columns that hold tasks.",
  inputSchema: {
    teamId: z
      .string()
      .optional()
      .describe("Only boards in this team. Omit for every board you can see."),
  },
  handler: async (input, { context }) => {
    const boards = await call(appRouter.board.list, undefined, { context });
    const filtered = input.teamId
      ? boards.filter((board) => board.team_id === input.teamId)
      : boards;

    if (filtered.length === 0) return text("No boards.");

    return text(
      [
        "# Boards",
        ...filtered.map(
          (board) =>
            `- \`${board.id}\` · ${board.name} (team: ${board.teamName}, ${board.cardCount} tasks)`,
        ),
      ].join("\n"),
    );
  },
});

const getBoard = define({
  name: "get_board",
  title: "Get a board",
  description:
    "Show a board's columns and the tasks in each, one line per task. Use get_task for the full detail of a single task.",
  inputSchema: {
    boardId: z.string().describe("Board id, from list_boards."),
  },
  handler: async (input, { context }) => {
    const board = await call(
      appRouter.board.get,
      { boardId: input.boardId },
      { context },
    );

    const lines = [`# ${board.name}`];
    for (const column of board.columns) {
      lines.push("");
      lines.push(`## ${column.name} (\`${column.id}\`) — ${column.cards.length}`);
      lines.push(
        column.cards.length
          ? column.cards.map(renderTaskLine).join("\n")
          : "_empty_",
      );
    }

    return text(lines.join("\n"));
  },
});

const searchTool = define({
  name: "search",
  title: "Search",
  description:
    "Fuzzy-search boards, task titles, task descriptions and comments across your teams. Use it to find a task when you only know roughly what it's called.",
  inputSchema: {
    query: z.string().min(2).describe("What to look for (typos tolerated)."),
  },
  handler: async (input, { context }) => {
    const results = await call(
      appRouter.search.global,
      { query: input.query },
      { context },
    );

    const lines: string[] = [];
    if (results.cards.length) {
      lines.push("## Tasks");
      for (const card of results.cards) {
        lines.push(`- \`${card.id}\` · ${card.title} — ${card.snippet ?? ""}`);
      }
    }
    if (results.boards.length) {
      lines.push("## Boards");
      for (const board of results.boards) {
        lines.push(`- \`${board.id}\` · ${board.name}`);
      }
    }
    if (results.comments.length) {
      lines.push("## Comments");
      for (const comment of results.comments) {
        lines.push(`- on task \`${comment.cardId}\` — ${comment.snippet ?? ""}`);
      }
    }

    return text(lines.length ? lines.join("\n") : "No matches.");
  },
});

const getTask = define({
  name: "get_task",
  title: "Get a task",
  description:
    "Everything about one task in a single call: description, every comment, assignees, tags, relations, and the list of attachments. Read this before starting work on a task.",
  inputSchema: {
    taskId: z.string().describe("Task id, from get_board or search."),
  },
  handler: async (input, { context }) => {
    const card = await call(
      appRouter.board.getCard,
      { cardId: input.taskId },
      { context },
    );

    const room = await call(
      appRouter.chat.open,
      { ref: { scope: "card", cardId: input.taskId }, limit: 100 },
      { context },
    );

    // History pages newest-first; a reader wants the conversation in order.
    const comments: TaskComment[] = [...room.messages]
      .reverse()
      .map((message) => ({
        id: message.id,
        authorName: message.author,
        body_text: extractLexicalText(message.body),
        // The chat payload is camelCase and carries an ISO string.
        created_at: new Date(message.createdAt),
      }));

    return text(
      renderTask(
        {
          id: card.id,
          title: card.title,
          description_text: card.description_text,
          tags: card.tags,
          boardName: card.boardName,
          columnName: card.columnName,
          archived_at: card.archived_at,
          archived_origin: card.archived_origin,
          created_at: new Date(card.created_at),
          assignees: card.assignees,
          relations: card.relations,
          attachments: card.attachments.map((attachment) => ({
            id: attachment.id,
            // The URL carries the storage id; get_attachment takes that id.
            path: attachment.url.split("fileId=")[1] ?? attachment.id,
            name: attachment.metadata?.name ?? "file",
            type: attachment.metadata?.type ?? "application/octet-stream",
          })),
        },
        comments,
      ),
    );
  },
});

const getAttachment = define({
  name: "get_attachment",
  title: "Read an attachment",
  description:
    "Fetch an attachment's contents by the id get_task prints. Images come back as images you can actually look at; text files come back as text.",
  inputSchema: {
    attachmentId: z
      .string()
      .describe("The attachment id exactly as get_task printed it."),
  },
  handler: async (input, { userId }) => {
    // Same gate as the browser route — one rule, both callers.
    const file = await assertFileAccess(userId, input.attachmentId);

    if (!(await fileService.exists(file.path))) {
      return { content: [{ type: "text", text: "File not found." }], isError: true };
    }

    const type = file.metadata.type ?? "application/octet-stream";
    const size = file.metadata.size ?? 0;

    if (size > MAX_ATTACHMENT_BYTES) {
      return {
        content: [
          {
            type: "text",
            text: `${file.metadata.name} is ${Math.round(size / 1024 / 1024)}MB, too large to inline.`,
          },
        ],
        isError: true,
      };
    }

    const bytes = Buffer.from(await fileService.readFile(file.path));

    // SVG is text, and images the model can't decode are better read as text
    // than handed over as an unusable blob.
    if (type.startsWith("image/") && type !== "image/svg+xml") {
      return {
        content: [{ type: "image", data: bytes.toString("base64"), mimeType: type }],
      };
    }

    if (type.startsWith("text/") || type === "image/svg+xml" || type === "application/json") {
      return text(bytes.toString("utf8"));
    }

    return {
      content: [
        {
          type: "text",
          text: `${file.metadata.name} is ${type}, which can't be read as text or image.`,
        },
      ],
      isError: true,
    };
  },
});

const createTask = define({
  name: "create_task",
  title: "Create a task",
  description:
    "Add a task to a board column. Pass a description in plain text; it is stored as the card's body.",
  inputSchema: {
    columnId: z.string().describe("Column id, from get_board."),
    title: z.string().min(1).describe("Task title."),
    description: z.string().optional().describe("Body text, plain text."),
    tags: z.array(z.string()).optional().describe("Tags to set."),
  },
  handler: async (input, { context }) => {
    const created = await call(
      appRouter.board.createCard,
      { columnId: input.columnId, title: input.title },
      { context },
    );

    // createCard takes only a title — body and tags are a follow-up update.
    if (input.description || input.tags) {
      await call(
        appRouter.board.updateCard,
        {
          cardId: created.id,
          ...(input.description
            ? { description: plainTextToLexical(input.description) }
            : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        },
        { context },
      );
    }

    return text(`Created task \`${created.id}\` — ${input.title}`);
  },
});

const updateTask = define({
  name: "update_task",
  title: "Update a task",
  description:
    "Change a task's title, description, tags, assignees, or move it to another column. Only the fields you pass are touched.",
  inputSchema: {
    taskId: z.string().describe("Task id."),
    title: z.string().optional(),
    description: z.string().optional().describe("Replacement body, plain text."),
    tags: z.array(z.string()).optional().describe("Replaces ALL tags."),
    assigneeIds: z
      .array(z.string())
      .optional()
      .describe("Replaces ALL assignees. User ids, from list_team_members."),
    columnId: z
      .string()
      .optional()
      .describe("Move the task to this column (e.g. to mark it done)."),
  },
  handler: async (input, { context }) => {
    const changed: string[] = [];

    if (
      input.title !== undefined ||
      input.description !== undefined ||
      input.tags !== undefined ||
      input.assigneeIds !== undefined
    ) {
      await call(
        appRouter.board.updateCard,
        {
          cardId: input.taskId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: plainTextToLexical(input.description) }
            : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.assigneeIds !== undefined
            ? { assigneeIds: input.assigneeIds }
            : {}),
        },
        { context },
      );
      changed.push("fields");
    }

    if (input.columnId !== undefined) {
      await call(
        appRouter.board.moveCard,
        { cardId: input.taskId, columnId: input.columnId },
        { context },
      );
      changed.push("column");
    }

    return text(
      changed.length
        ? `Updated task \`${input.taskId}\` (${changed.join(", ")}).`
        : "Nothing to update.",
    );
  },
});

const commentTask = define({
  name: "comment_task",
  title: "Comment on a task",
  description:
    "Post a plain-text comment on a task's discussion. Use it to report what you did, ask a question, or leave notes for the humans.",
  inputSchema: {
    taskId: z.string().describe("Task id."),
    body: z.string().min(1).describe("Comment text."),
  },
  handler: async (input, { context }) => {
    const room = await call(
      appRouter.chat.open,
      { ref: { scope: "card", cardId: input.taskId }, limit: 1 },
      { context },
    );

    await call(
      appRouter.chat.send,
      { roomId: room.roomId, body: plainTextToLexical(input.body) },
      { context },
    );

    return text(`Commented on \`${input.taskId}\`.`);
  },
});

const archiveTask = define({
  name: "archive_task",
  title: "Archive a task",
  description:
    "Move a task into its team's archive. Reversible in the app; nothing is destroyed.",
  inputSchema: { taskId: z.string().describe("Task id.") },
  handler: async (input, { context }) => {
    await call(
      appRouter.board.archiveCard,
      { cardId: input.taskId },
      { context },
    );
    return text(`Archived \`${input.taskId}\`.`);
  },
});

const listTeamMembers = define({
  name: "list_team_members",
  title: "List team members",
  description:
    "The people in a team, with the user ids that update_task's assigneeIds expects.",
  inputSchema: { teamId: z.string().describe("Team id, from list_teams.") },
  handler: async (input, { context }) => {
    const members = await call(
      appRouter.team.members,
      { teamId: input.teamId },
      { context },
    );

    return text(
      [
        "# Members",
        ...members.map((member) => `- \`${member.id}\` · ${member.name}`),
      ].join("\n"),
    );
  },
});

/** The curated external surface. Deliberately NOT a mirror of the router:
 *  subscriptions, presence, uploads, the support widget and the game/deck
 *  procedures are not here, and the tools are shaped around assigning and
 *  working a task rather than around our internal procedures. */
export const TOOLS: ToolDef[] = [
  listTeams,
  listBoards,
  listTeamMembers,
  getBoard,
  searchTool,
  getTask,
  getAttachment,
  createTask,
  updateTask,
  commentTask,
  archiveTask,
];

export const toolByName = (name: string): ToolDef | undefined =>
  TOOLS.find((tool) => tool.name === name);
