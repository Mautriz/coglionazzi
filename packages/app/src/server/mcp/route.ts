import { bearerToken, resolveApiKey } from "../apiKeys";
import { handleMcpRequest } from "./server";

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

const unauthorized = (message: string): Response =>
  new Response(message, {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="insacco"' },
  });

/** The MCP endpoint. Authenticated by API key ONLY — this is the external
 *  surface, so a browser session cookie deliberately does not grant access
 *  (that would make the endpoint reachable cross-site by a logged-in user's
 *  browser).
 *
 *  Lives here rather than in the route file so it can be tested directly. */
export async function serveMcp(request: Request): Promise<Response> {
  const expected = allowedHost();
  const host = request.headers.get("host");
  if (expected && host && host !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = bearerToken(request.headers);
  if (!token) {
    return unauthorized(
      "Missing API key. Send `Authorization: Bearer ins_…` — create one in Insacco under API keys.",
    );
  }

  const key = await resolveApiKey(token);
  if (!key) return unauthorized("Invalid or revoked API key.");

  return handleMcpRequest(
    request,
    {
      // The tools call oRPC procedures, which resolve the caller from these
      // headers exactly as they would for any HTTP request.
      reqHeaders: request.headers,
      resHeaders: new Headers(),
    },
    key.userId,
  );
}
