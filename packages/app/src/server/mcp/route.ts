import { resolveBearerCaller } from "../bearerAuth";
import { handleMcpRequest } from "./server";

/** CORS for the MCP endpoint. A connector configured in a web app (claude.ai)
 *  sends an `Authorization` header cross-origin, which forces a preflight —
 *  and without these the browser blocks the real request before it is ever
 *  sent, so the server looks unreachable while answering curl perfectly.
 *
 *  `*` is deliberate and SAFE here precisely because this endpoint refuses
 *  cookies: a wildcard origin forbids credentialed requests, so no logged-in
 *  user's browser can be made to call it with their session attached. The
 *  bearer credential is the only way in, exactly as before.
 *
 *  `WWW-Authenticate` must be exposed or an OAuth-capable client cannot read
 *  the challenge that tells it where to authenticate. */
export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** Reply to the preflight the browser sends before a cross-origin POST that
 *  carries an Authorization header. */
export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}

/** Copy the CORS headers onto a response the MCP SDK produced. */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Origins allowed to reach the MCP endpoint by Host header. Neither SDK
 *  validates Host/Origin, so DNS-rebinding defence is ours to do. */
function allowedHost(): string | null {
  const configured = process.env.VITE_FRONTEND_URL;
  if (!configured) return null;
  try {
    return new URL(configured).host;
  } catch {
    return null;
  }
}

/** The public origin, for absolute URLs in the OAuth challenge. Configured in
 *  production; falls back to the request's own origin (dev/tests). */
function publicOrigin(request: Request): string {
  const configured = process.env.VITE_FRONTEND_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(request.url).origin;
}

/** 401 with the RFC 9728 challenge: an OAuth-capable client (claude.ai,
 *  Claude Code) reads `resource_metadata`, discovers our authorization server
 *  and starts the login flow on its own. Plain clients just read the text. */
const unauthorized = (request: Request, message: string): Response =>
  new Response(message, {
    status: 401,
    headers: {
      ...MCP_CORS_HEADERS,
      "WWW-Authenticate": `Bearer realm="insacco", resource_metadata="${publicOrigin(request)}/.well-known/oauth-protected-resource"`,
    },
  });

/** The MCP endpoint. Authenticated by a bearer credential ONLY — an `ins_…`
 *  API key or an OAuth access token from better-auth's mcp plugin. This is the
 *  external surface, so a browser session cookie deliberately does not grant
 *  access (that would make the endpoint reachable cross-site by a logged-in
 *  user's browser).
 *
 *  Lives here rather than in the route file so it can be tested directly. */
export async function serveMcp(request: Request): Promise<Response> {
  const expected = allowedHost();
  const host = request.headers.get("host");
  if (expected && host && host !== expected) {
    return new Response("Forbidden", { status: 403, headers: MCP_CORS_HEADERS });
  }

  const caller = await resolveBearerCaller(request.headers);
  if (caller.kind === "absent") {
    return unauthorized(
      request,
      "Missing credentials. Connect with OAuth (claude.ai connector, or `/mcp` in Claude Code), or send `Authorization: Bearer ins_…` — create one in Insacco under API keys.",
    );
  }
  if (caller.kind === "invalid") {
    return unauthorized(request, "Invalid, expired or revoked credential.");
  }

  return withCors(
    await handleMcpRequest(
      request,
      {
        // The tools call oRPC procedures, which resolve the caller from these
        // headers exactly as they would for any HTTP request.
        reqHeaders: request.headers,
        resHeaders: new Headers(),
      },
      caller.userId,
    ),
  );
}
