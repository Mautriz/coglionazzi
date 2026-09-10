import { ORPCError, os } from "@orpc/server";
import { bearerToken, resolveApiKey } from "../apiKeys";
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
 *  2. an `Authorization: Bearer ins_…` API key (external clients — bots and
 *     Claude Code over MCP),
 *  3. the session cookie (HTTP/SSR via RequestHeadersPlugin).
 *
 *  Because every `authP` procedure reads `context.user`, adding the key branch
 *  HERE is what lets external callers use the whole API with no per-procedure
 *  changes. Returns null when unauthenticated.
 *
 *  An API-key caller has no better-auth session row, so `session` is null for
 *  them and `viaApiKey` says so. */
export async function resolveSession(context: ORPCContext): Promise<{
  user: AuthUser;
  session: AuthSession | null;
  headers: Headers | HeadersInit;
  viaApiKey: boolean;
} | null> {
  if (context.connection?.user) {
    const { user, session, headers } = context.connection;
    return { user, session, headers, viaApiKey: false };
  }
  if (!context.reqHeaders) return null;

  const headers = new Headers(context.reqHeaders as HeadersInit);

  const token = bearerToken(headers);
  if (token) {
    const key = await resolveApiKey(token);
    // A bearer token that looks like ours but doesn't resolve is a failed
    // attempt, not an invitation to fall through to the cookie.
    if (!key) return null;

    const user = await userById(key.userId);
    if (!user) return null;

    return { user, session: null, headers, viaApiKey: true };
  }

  const { summary } = await getAuthSession(context.reqHeaders);
  if (!summary?.user) return null;
  return {
    user: summary.user,
    session: summary.session,
    headers,
    viaApiKey: false,
  };
}

/** Load the user an API key belongs to, shaped like better-auth's session
 *  user so downstream code can't tell the transports apart. */
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
