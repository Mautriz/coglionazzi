import { auth } from "./auth";
import { resolveBearerCaller } from "./bearerAuth";

/** Who is making a plain-HTTP request (i.e. outside oRPC). */
export interface HttpCaller {
  userId: string;
  /** How they authenticated — `apiKey` and `oauth` callers are external
   *  clients (scripts, Claude Code, claude.ai). */
  via: "session" | "apiKey" | "oauth";
}

/** Resolve the caller of a non-oRPC HTTP route.
 *
 *  This is the single place plain routes (`/api/files`, `/api/mcp`) identify
 *  a caller: bearer credentials (API key or OAuth token) through the shared
 *  `resolveBearerCaller`, then the session cookie. oRPC procedures do not use
 *  this — they go through `resolveSession` in `orpc/base.ts`, which
 *  reconciles the WebSocket transport too, but calls the same bearer helper. */
export async function resolveHttpCaller(
  request: Request,
): Promise<HttpCaller | null> {
  const bearer = await resolveBearerCaller(request.headers);
  if (bearer.kind === "invalid") return null;
  if (bearer.kind === "ok") return { userId: bearer.userId, via: bearer.via };

  const summary = await auth.api.getSession({ headers: request.headers });
  if (summary?.user) return { userId: summary.user.id, via: "session" };

  return null;
}
