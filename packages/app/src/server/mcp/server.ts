import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
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

/** Serve one MCP request. Stateless: a fresh server + transport per request
 *  (there is no session to resume and nothing to keep in memory between
 *  calls). The transport handles POST, and also GET — the standalone SSE
 *  stream a Streamable HTTP client opens to receive server-initiated
 *  messages. We hand GET straight to it rather than answering 405 ourselves:
 *  a client that treats the stream as required otherwise gives up right after
 *  a successful `initialize`, which looks like "the server is unreachable".
 *
 *  A GET answers with a stream that stays open, so the server must NOT be
 *  closed when `handleRequest` returns — only once the body is done. */
export async function handleMcpRequest(
  request: Request,
  context: ORPCContext,
  userId: string,
): Promise<Response> {
  const server = createMcpServer({ context, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  let response: Response;
  try {
    response = await transport.handleRequest(request);
  } catch (err) {
    await server.close();
    throw err;
  }

  const streaming =
    response.headers.get("content-type")?.includes("text/event-stream") ===
      true && response.body !== null;

  if (!streaming) {
    await server.close();
    return response;
  }

  // Tie the server's lifetime to the stream: closing it early would cut the
  // SSE connection the client is waiting on, and never closing it would leak
  // one server per stream.
  const body = response.body!.pipeThrough(
    new TransformStream({
      flush: () => {
        void server.close();
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
