import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { serveMcp } from "../src/server/mcp/route";
import { apiKeyRouter } from "../src/server/orpc/apiKeys";
import { boardRouter } from "../src/server/orpc/boards";
import type { ORPCContext } from "../src/server/orpc/base";
import { createTestTeam, signUpTestUser } from "./helpers";

const MCP_HEADERS = {
  "content-type": "application/json",
  // Streamable HTTP requires the client to accept both.
  accept: "application/json, text/event-stream",
};

function rpc(method: string, params: unknown = {}, id: number | null = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function post(body: string, token?: string): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

/** Drive the initialize handshake, then run `method`. */
async function mcpCall(token: string, method: string, params: unknown = {}) {
  await serveMcp(
    post(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      }),
      token,
    ),
  );

  const response = await serveMcp(post(rpc(method, params, 2), token));
  return { response, body: await response.text() };
}

async function keyFor(context: ORPCContext): Promise<string> {
  const { token } = await call(apiKeyRouter.create, { name: "bot" }, { context });
  return token;
}

describe("MCP endpoint authentication", () => {
  it("refuses a request with no API key", async () => {
    const response = await serveMcp(post(rpc("initialize")));

    expect(response.status).toBe(401);
  });

  it("tells an unauthenticated caller how to get a key", async () => {
    const response = await serveMcp(post(rpc("initialize")));

    expect(await response.text()).toMatch(/API key/i);
  });

  it("refuses an unknown API key", async () => {
    const response = await serveMcp(post(rpc("initialize"), "ins_bogus"));

    expect(response.status).toBe(401);
  });

  it("refuses a revoked API key", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await call(
      apiKeyRouter.create,
      { name: "bot" },
      { context },
    );
    await call(apiKeyRouter.revoke, { id: created.id }, { context });

    const response = await serveMcp(post(rpc("initialize"), created.token));

    expect(response.status).toBe(401);
  });

  it("does NOT accept a browser session cookie", async () => {
    // The MCP endpoint is the external surface; accepting cookies would make
    // it reachable cross-site from a logged-in user's browser.
    const { context } = await signUpTestUser("owner");
    const cookie = new Headers(context.reqHeaders as HeadersInit).get("cookie");

    const response = await serveMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...MCP_HEADERS, cookie: cookie ?? "" },
        body: rpc("initialize"),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a valid API key", async () => {
    const { context } = await signUpTestUser("owner");
    const token = await keyFor(context);

    const response = await serveMcp(post(rpc("initialize"), token));

    expect(response.status).toBe(200);
  });
});

describe("MCP protocol", () => {
  it("advertises every curated tool", async () => {
    const { context } = await signUpTestUser("owner");
    const token = await keyFor(context);

    const { body } = await mcpCall(token, "tools/list");

    for (const name of [
      "list_teams",
      "list_boards",
      "list_team_members",
      "get_board",
      "search",
      "get_task",
      "get_attachment",
      "create_task",
      "update_task",
      "comment_task",
      "archive_task",
    ]) {
      expect(body).toContain(name);
    }
  });

  it("does not expose internal procedures as tools", async () => {
    const { context } = await signUpTestUser("owner");
    const token = await keyFor(context);

    const { body } = await mcpCall(token, "tools/list");

    expect(body).not.toContain("subscribe");
    expect(body).not.toContain("presence");
    expect(body).not.toContain("widget");
  });

  it("runs a tool as the key's owner", async () => {
    const { context } = await signUpTestUser("owner");
    await createTestTeam(context, "Coglionazzi");
    const token = await keyFor(context);

    const { body } = await mcpCall(token, "tools/call", {
      name: "list_teams",
      arguments: {},
    });

    expect(body).toContain("Coglionazzi");
  });

  it("never leaks another user's data to a key", async () => {
    const { context: strangerCtx } = await signUpTestUser("stranger");
    await createTestTeam(strangerCtx, "Not Yours");

    const { context } = await signUpTestUser("owner");
    const token = await keyFor(context);

    const { body } = await mcpCall(token, "tools/call", {
      name: "list_teams",
      arguments: {},
    });

    expect(body).not.toContain("Not Yours");
  });

  it("reports a domain error as a tool error rather than crashing", async () => {
    const { context } = await signUpTestUser("owner");
    const token = await keyFor(context);

    const { response, body } = await mcpCall(token, "tools/call", {
      name: "get_task",
      arguments: { taskId: "00000000-0000-0000-0000-000000000000" },
    });

    expect(response.status).toBe(200);
    expect(body).toMatch(/NOT_FOUND|FORBIDDEN/);
  });

  it("gets a task end to end over the protocol", async () => {
    const { context } = await signUpTestUser("owner");
    const teamId = await createTestTeam(context);
    const board = await call(
      boardRouter.create,
      { name: "B", teamId },
      { context },
    );
    const column = await call(
      boardRouter.addColumn,
      { boardId: board.id, name: "Todo" },
      { context },
    );
    const card = await call(
      boardRouter.createCard,
      { columnId: column.id, title: "Ship the MCP server" },
      { context },
    );
    const token = await keyFor(context);

    const { body } = await mcpCall(token, "tools/call", {
      name: "get_task",
      arguments: { taskId: card.id },
    });

    expect(body).toContain("Ship the MCP server");
  });
});
