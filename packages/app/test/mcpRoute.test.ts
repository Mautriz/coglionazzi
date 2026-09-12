import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { mcpPreflight, serveMcp } from "../src/server/mcp/route";
import { apiKeyRouter } from "../src/server/orpc/apiKeys";
import { boardRouter } from "../src/server/orpc/boards";
import type { ORPCContext } from "../src/server/orpc/base";
import { createTestTeam, signUpTestUser } from "./helpers";
import {
  AUTH_ORIGIN,
  cookieOf,
  expireOAuthToken,
  mintOAuthToken,
} from "./oauthHelpers";

const MCP_HEADERS = {
  "content-type": "application/json",
  // Streamable HTTP requires the client to accept both.
  accept: "application/json, text/event-stream",
};

function rpc(method: string, params: unknown = {}, id: number | null = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** A well-formed `initialize` — the handshake is validated against the MCP
 *  schema, so empty params are rejected as a bad request. */
function initRpc(id = 1) {
  return rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
    id,
  );
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

    const response = await serveMcp(post(initRpc(), token));

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

describe("MCP endpoint with OAuth access tokens", () => {
  it("tells an OAuth-capable client where the authorization server is (RFC 9728)", async () => {
    const response = await serveMcp(post(rpc("initialize")));

    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    // The public origin (VITE_FRONTEND_URL), not the request's host — the
    // challenge has to name a URL the CLIENT can reach.
    expect(challenge).toContain(
      `resource_metadata="${AUTH_ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });

  it("accepts an OAuth access token and acts as its user", async () => {
    const { context } = await signUpTestUser("grace");
    await createTestTeam(context, "Grace's crew");
    const token = await mintOAuthToken(cookieOf(context));

    const { response, body } = await mcpCall(token, "tools/call", {
      name: "list_teams",
      arguments: {},
    });

    expect(response.status).toBe(200);
    expect(body).toContain("Grace's crew");
  });

  it("refuses an expired OAuth token", async () => {
    const { context } = await signUpTestUser("heidi");
    const token = await mintOAuthToken(cookieOf(context));
    await expireOAuthToken(token);

    const response = await serveMcp(post(rpc("initialize"), token));

    expect(response.status).toBe(401);
  });
});

describe("MCP endpoint CORS", () => {
  // A connector configured inside a web app sends `Authorization`
  // cross-origin, which forces a preflight. Without these headers the browser
  // blocks the real request and the server looks unreachable while answering
  // curl perfectly — the exact failure claude.ai reported.
  it("answers the preflight with the headers a browser needs", () => {
    const response = mcpPreflight();

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it("exposes WWW-Authenticate so a client can read the challenge", () => {
    expect(
      mcpPreflight().headers.get("access-control-expose-headers"),
    ).toContain("WWW-Authenticate");
  });

  it("puts CORS on the 401 too", async () => {
    const response = await serveMcp(post(rpc("initialize")));

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("puts CORS on a successful response", async () => {
    const { context } = await signUpTestUser("cors");
    const token = await keyFor(context);

    const response = await serveMcp(post(initRpc(), token));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("MCP endpoint Accept handling", () => {
  // The SDK transport 406s unless Accept lists BOTH json and event-stream, by
  // literal substring — so even a wildcard fails. Clients that send anything
  // else saw "couldn't reach the server". We answer JSON regardless.
  async function initializeWith(accept: string | null, token: string) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
    if (accept !== null) headers.accept = accept;

    return serveMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers,
        body: rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        }),
      }),
    );
  }

  const acceptCases: Array<[string | null, string]> = [
    ["application/json, text/event-stream", "both, the strict pair"],
    ["application/json", "json only"],
    ["*/*", "a wildcard"],
    [null, "no Accept header at all"],
  ];

  it.each(acceptCases)("serves a client sending %s (%s)", async (accept) => {
    const { context } = await signUpTestUser("accept");
    const token = await keyFor(context);

    const response = await initializeWith(accept, token);

    expect(response.status).toBe(200);
  });

  it("still authenticates before touching the body", async () => {
    const response = await initializeWith("*/*", "ins_bogus");

    expect(response.status).toBe(401);
  });
});

describe("MCP standalone SSE stream (GET)", () => {
  // A Streamable HTTP client may open a GET stream for server-initiated
  // messages right after initialize. We used to answer 405 from the route
  // file, unauthenticated and unlogged, which made such a client give up
  // immediately after a successful handshake.
  function get(token?: string): Request {
    return new Request("http://localhost/api/mcp", {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  it("requires a credential, like every other method", async () => {
    const response = await serveMcp(get());

    expect(response.status).toBe(401);
  });

  it("opens an event stream for an authenticated client", async () => {
    const { context } = await signUpTestUser("streamer");
    const token = await keyFor(context);

    const response = await serveMcp(get(token));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  it("puts CORS on the stream too", async () => {
    const { context } = await signUpTestUser("streamer2");
    const token = await keyFor(context);

    const response = await serveMcp(get(token));

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await response.body?.cancel();
  });
});

describe("MCP sessions", () => {
  // Stateless mode returns no Mcp-Session-Id, and a client that treats the
  // session as required then retries initialize forever without ever calling
  // a tool — exactly what the claude.ai connector did.
  async function initialize(token: string) {
    return serveMcp(
      post(
        rpc("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        }),
        token,
      ),
    );
  }

  function withSession(body: string, token: string, sessionId: string) {
    return new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        authorization: `Bearer ${token}`,
        "mcp-session-id": sessionId,
      },
      body,
    });
  }

  it("returns a session id from initialize", async () => {
    const { context } = await signUpTestUser("sess");
    const token = await keyFor(context);

    const response = await initialize(token);

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toMatch(/[0-9a-f-]{36}/);
  });

  it("reuses the session for a later tool call", async () => {
    const { context } = await signUpTestUser("sess2");
    await createTestTeam(context, "Session Team");
    const token = await keyFor(context);
    const sessionId = (await initialize(token)).headers.get("mcp-session-id")!;

    const response = await serveMcp(
      withSession(
        rpc("tools/call", { name: "list_teams", arguments: {} }, 2),
        token,
        sessionId,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Session Team");
  });

  it("refuses another user's session id as if it did not exist", async () => {
    const { context: ownerCtx } = await signUpTestUser("sessowner");
    await createTestTeam(ownerCtx, "Private Team");
    const ownerToken = await keyFor(ownerCtx);
    const sessionId = (await initialize(ownerToken)).headers.get(
      "mcp-session-id",
    )!;

    const { context: strangerCtx } = await signUpTestUser("stranger2");
    const strangerToken = await keyFor(strangerCtx);

    const response = await serveMcp(
      withSession(
        rpc("tools/call", { name: "list_teams", arguments: {} }, 2),
        strangerToken,
        sessionId,
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private Team");
  });

  it("refuses an unknown session id", async () => {
    const { context } = await signUpTestUser("sess3");
    const token = await keyFor(context);

    const response = await serveMcp(
      withSession(
        rpc("tools/list", {}, 2),
        token,
        "00000000-0000-4000-8000-000000000000",
      ),
    );

    expect(response.status).toBe(404);
  });

  it("still requires a credential even with a valid session id", async () => {
    const { context } = await signUpTestUser("sess4");
    const token = await keyFor(context);
    const sessionId = (await initialize(token)).headers.get("mcp-session-id")!;

    const response = await serveMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...MCP_HEADERS, "mcp-session-id": sessionId },
        body: rpc("tools/list", {}, 2),
      }),
    );

    expect(response.status).toBe(401);
  });
});
