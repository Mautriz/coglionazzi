import { createFileRoute } from "@tanstack/react-router";
import { serveMcp } from "../../server/mcp/route";

/** MCP endpoint for external clients — claude.ai custom connectors and Claude
 *  Code. Two ways in:
 *
 *    - OAuth (no key): add `<origin>/api/mcp` as a connector / run
 *      `claude mcp add --transport http insacco <origin>/api/mcp` and log in
 *      when prompted (better-auth's mcp plugin is the authorization server);
 *    - API key: the same command with
 *      `--header "Authorization: Bearer ins_..."`.
 *
 *  The logic lives in `server/mcp/route.ts`. */
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
