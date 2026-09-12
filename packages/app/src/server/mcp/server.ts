import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomUUID } from "node:crypto";
import { rpcMethodOf } from "./log";
import {
  dropSession,
  getSession,
  putSession,
  reapIdleSessions,
} from "./sessions";
import { ORPCError } from "@orpc/server";
import type { ORPCContext } from "../orpc/base";
import { TOOLS, type ToolCtx } from "./tools";

/** Build an MCP server exposing the curated tools as `ctx`'s user. */
export function createMcpServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: "insacco", version: "1.0.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (input: unknown) => {
        try {
          return (await tool.handler(input as never, ctx)) as never;
        } catch (error) {
          // Domain errors (FORBIDDEN, NOT_FOUND, …) are answers, not crashes —
          // hand the message back so the model can act on it.
          if (error instanceof ORPCError) {
            return {
              content: [{ type: "text", text: `${error.code}: ${error.message}` }],
              isError: true,
            } as never;
          }
          throw error;
        }
      },
    );
  }

  return server;
}

/** Serve one MCP request.
 *
 *  HYBRID session handling, because MCP clients disagree about sessions:
 *
 *  - `initialize` mints a session and the SDK returns its id in
 *    `Mcp-Session-Id`. Stateless mode returns no id at all, and a client that
 *    treats a session as required then retries the handshake forever without
 *    ever calling a tool — what the claude.ai connector did.
 *  - A request carrying a session id reuses that session's server+transport.
 *  - A request WITHOUT one is still served standalone, on a throwaway
 *    stateless transport. Claude Code, curl and our own tests work that way,
 *    and requiring the id would have broken every one of them.
 *
 *  Sessions live in memory, so this is single-instance like the rest of the
 *  realtime layer; a restart costs clients one extra handshake.
 *
 *  A session is bound to the user who created it: an id presented by anyone
 *  else is answered as unknown, so it can neither be probed for existence nor
 *  used to act as its owner. */
export async function handleMcpRequest(
  request: Request,
  context: ORPCContext,
  userId: string,
  body: string,
): Promise<Response> {
  const requestedSession = request.headers.get("mcp-session-id");

  if (requestedSession) {
    const found = getSession(requestedSession, userId);
    if (found.kind !== "found") return sessionNotFound();

    if (request.method === "DELETE") {
      const response = await found.session.transport.handleRequest(request);
      await dropSession(requestedSession);
      return response;
    }

    return streamAware(
      await found.session.transport.handleRequest(request),
      null,
    );
  }

  const isHandshake = rpcMethodOf(body) === "initialize";
  const server = createMcpServer({ context, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Only a handshake opens a session; anything else is served standalone,
    // exactly as before sessions existed.
    sessionIdGenerator: isHandshake ? () => randomUUID() : undefined,
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      putSession(sessionId, {
        server,
        transport,
        userId,
        lastUsedAt: Date.now(),
      });
    },
  });

  await server.connect(transport);

  let response: Response;
  try {
    response = await transport.handleRequest(request);
  } catch (err) {
    await server.close();
    throw err;
  }

  // Tidy up anything abandoned, now that we know the process is in use.
  void reapIdleSessions();

  // A request that opened a session handed its server to the registry; one
  // that did not still owns it and must close it.
  const adopted = transport.sessionId !== undefined;
  return streamAware(response, adopted ? null : server);
}

/** Same answer for "no such session" and "not yours" — see the note above. */
function sessionNotFound(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
}

/** Return `response`, closing `owner` (when given) once the body is done —
 *  an SSE stream must outlive the handler that produced it. */
function streamAware(response: Response, owner: McpServer | null): Response {
  const streaming =
    response.headers.get("content-type")?.includes("text/event-stream") ===
      true && response.body !== null;

  if (!streaming) {
    if (owner) void owner.close();
    return response;
  }

  if (!owner) return response;

  const body = response.body!.pipeThrough(
    new TransformStream({
      flush: () => {
        void owner.close();
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
