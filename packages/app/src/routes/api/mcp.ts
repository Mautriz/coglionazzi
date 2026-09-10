import { createFileRoute } from "@tanstack/react-router";
import { serveMcp } from "../../server/mcp/route";

/** MCP endpoint for external clients — above all Claude Code:
 *
 *    claude mcp add --transport http insacco <origin>/api/mcp \
 *      --header "Authorization: Bearer ins_..."
 *
 *  Authenticated by API key; the logic lives in `server/mcp/route.ts`. */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => serveMcp(request),
      // Streamable HTTP clients may probe GET/DELETE for a resumable session;
      // this server is stateless, so say so rather than 404ing.
      GET: () => new Response("Method Not Allowed", { status: 405 }),
      DELETE: () => new Response("Method Not Allowed", { status: 405 }),
    },
  },
});
