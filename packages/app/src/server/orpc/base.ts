import { ORPCError, os } from "@orpc/server";
import {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { auth } from "../auth";

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

/** Resolve the caller's session from whichever transport is in play: the
 *  WebSocket connection (auth fixed at upgrade) or per-request headers
 *  (HTTP/SSR via RequestHeadersPlugin). Returns null when unauthenticated. */
export async function resolveSession(context: ORPCContext): Promise<{
  user: AuthUser;
  session: AuthSession;
  headers: Headers | HeadersInit;
} | null> {
  if (context.connection?.user) {
    const { user, session, headers } = context.connection;
    return { user, session, headers };
  }
  if (!context.reqHeaders) return null;
  const { summary, headers } = await getAuthSession(context.reqHeaders);
  if (!summary?.user) return null;
  return { user: summary.user, session: summary.session, headers };
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
