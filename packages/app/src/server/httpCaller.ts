import { auth } from "./auth";

/** Who is making a plain-HTTP request (i.e. outside oRPC). */
export interface HttpCaller {
  userId: string;
  /** How they authenticated — API-key callers are external clients. */
  via: "session" | "apiKey";
}

/** Resolve the caller of a non-oRPC HTTP route from the session cookie.
 *
 *  This is the single place plain routes (`/api/files`, `/api/mcp`) identify
 *  a caller, so the API-key branch is added HERE rather than in each route.
 *  oRPC procedures do not use this — they go through `resolveSession` in
 *  `orpc/base.ts`, which reconciles the WebSocket transport too. */
export async function resolveHttpCaller(
  request: Request,
): Promise<HttpCaller | null> {
  const summary = await auth.api.getSession({ headers: request.headers });
  if (summary?.user) return { userId: summary.user.id, via: "session" };

  return null;
}
