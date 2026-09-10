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

/** Serve one MCP request. Stateless: a fresh server + transport per request,
 *  which is what a single request/response POST route wants (there is no
 *  session to resume and nothing to keep in memory between calls). */
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

  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
