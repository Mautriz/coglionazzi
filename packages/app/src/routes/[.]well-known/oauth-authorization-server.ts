import { createFileRoute } from "@tanstack/react-router";
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "../../server/auth";

/** OAuth 2.0 Authorization Server Metadata (RFC 8414) at the site ROOT.
 *  better-auth's mcp plugin serves the same document under
 *  `/api/auth/.well-known/…`, but MCP clients (claude.ai, Claude Code) take
 *  our bare origin from the protected-resource document and append the
 *  well-known path to THAT — so it has to exist here too. */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")(
  {
    server: {
      handlers: {
        GET: ({ request }) => oAuthDiscoveryMetadata(auth)(request),
      },
    },
  },
);
