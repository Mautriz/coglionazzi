import { createFileRoute } from "@tanstack/react-router";
import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "../../server/auth";

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) at the site ROOT — the
 *  location clients probe after reading the `WWW-Authenticate` challenge from
 *  /api/mcp. Names `/api/mcp` as the resource and our origin as its
 *  authorization server. */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => oAuthProtectedResourceMetadata(auth)(request),
    },
  },
});
