import { createFileRoute } from "@tanstack/react-router";
import { mcpPreflight, serveMcp } from "../../server/mcp/route";

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
      // A browser-hosted connector (claude.ai) preflights the POST because it
      // carries an Authorization header. Without this the real request is
      // never sent and the server looks unreachable.
      OPTIONS: () => mcpPreflight(),
      // GET opens the standalone SSE stream and DELETE ends a session. Both go
      // through `serveMcp` so they are authenticated, logged, and handled by
      // the MCP SDK — answering 405 here ourselves made a client that opens
      // the stream give up right after a successful initialize, invisibly.
      GET: ({ request }) => serveMcp(request),
      DELETE: ({ request }) => serveMcp(request),
    },
  },
});
