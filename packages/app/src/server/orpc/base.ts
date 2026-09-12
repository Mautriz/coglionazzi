import { ORPCError, os } from "@orpc/server";
import { resolveBearerCaller } from "../bearerAuth";
import {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { auth } from "../auth";
import { db } from "../db";

type SessionSummary = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;
export type AuthUser = SessionSummary["user"];
export type AuthSession = SessionSummary["session"];

/** Auth resolved ONCE at WebSocket upgrade and carried for the connection's
 *  lifetime (WS frames don't carry per-message cookies — see the WS adapter
 *  in `src/server/ws`). The 5-minute re-check refreshes `user`/`session`. */
export interface ConnectionAuth {
  user: AuthUser;
  session: AuthSession;
  /** The upgrade request's headers (cookie included) for periodic re-check. */
  headers: Headers;
}

export interface ORPCContext
  extends RequestHeadersPluginContext,
    ResponseHeadersPluginContext {
  request?: Request;
  /** Present on the WebSocket transport only; set by the upgrade handler. */
  connection?: ConnectionAuth;
}

export const t = os.$context<ORPCContext>();

export async function getAuthSession(headers: HeadersInit) {
  const summary = await auth.api.getSession({
    headers,
  });

  return { summary, headers };
}

/** Resolve the caller's session from whichever transport is in play:
 *  1. the WebSocket connection (auth fixed at upgrade),
 *  2. an `Authorization: Bearer …` credential — an `ins_…` API key OR an
 *     OAuth access token from the mcp plugin (external clients: bots, Claude
 *     Code, claude.ai),
 *  3. the session cookie (HTTP/SSR via RequestHeadersPlugin).
 *
 *  Because every `authP` procedure reads `context.user`, adding the bearer
 *  branch HERE is what lets external callers use the whole API with no
 *  per-procedure changes. Returns null when unauthenticated.
 *
 *  A bearer caller has no better-auth session row, so `session` is null for
 *  them and `viaBearer` says so. */
export async function resolveSession(context: ORPCContext): Promise<{
  user: AuthUser;
  session: AuthSession | null;
  headers: Headers | HeadersInit;
  viaBearer: boolean;
} | null> {
  if (context.connection?.user) {
    const { user, session, headers } = context.connection;
    return { user, session, headers, viaBearer: false };
  }
  if (!context.reqHeaders) return null;

  const headers = new Headers(context.reqHeaders as HeadersInit);

  const bearer = await resolveBearerCaller(headers);
  // A credential that was presented and failed is a failed attempt, not an
  // invitation to fall through to the cookie.
  if (bearer.kind === "invalid") return null;
  if (bearer.kind === "ok") {
    const user = await userById(bearer.userId);
    if (!user) return null;

    return { user, session: null, headers, viaBearer: true };
  }

  const { summary } = await getAuthSession(context.reqHeaders);
  if (!summary?.user) return null;
  return {
    user: summary.user,
    session: summary.session,
    headers,
    viaBearer: false,
  };
}

/** Load the user a bearer credential belongs to, shaped like better-auth's
 *  session user so downstream code can't tell the transports apart. */
async function userById(id: string): Promise<AuthUser | null> {
  const row = await db
    .selectFrom("users")
    .where("id", "=", id)
    .select([
      "id",
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    image: row.image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as AuthUser;
}

/** Procedures built on `authP` require a logged-in user; `context.user` and
 *  `context.session` are populated. Works over both transports. */
export const authP = t.use(async (info) => {
  const resolved = await resolveSession(info.context);

  if (!resolved) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "You must be logged in to perform this action.",
    });
  }

  return info.next({
    context: {
      session: resolved.session,
      user: resolved.user,
      headers: resolved.headers,
    },
  });
});
