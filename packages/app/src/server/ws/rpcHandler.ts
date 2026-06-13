import { experimental_RPCHandler as CrosswsRPCHandler } from "@orpc/server/crossws";
import type { Peer } from "crossws";
import { defineWebSocketHandler } from "h3";
import { auth } from "../auth";
import type { ConnectionAuth, ORPCContext } from "../orpc/base";
import { appRouter } from "../orpc/router";

/** The oRPC RPC handler over the crossws (Nitro) WebSocket adapter. Serves the
 *  SAME appRouter as the HTTP handler — request/response calls multiplex over
 *  the socket, and Event Iterator procedures stream realtime updates. */
const handler = new CrosswsRPCHandler<ORPCContext>(appRouter);

/** Re-validate the session this often. WS frames carry no cookies, so auth is
 *  fixed at upgrade; this catches logout/expiry/revocation within the window.
 *  (Immediate logout is also handled client-side by closing the socket.) */
const SESSION_RECHECK_MS = 5 * 60 * 1000;

/** The context object we stash on each peer (`peer.context`). `connection` is
 *  present only for authenticated sockets; anonymous sockets carry none and
 *  `authP` rejects their protected calls (public procedures still work). */
type WsPeerContext = ORPCContext & { connection?: ConnectionAuth };

/** Per-connection re-check timers, keyed by peer (avoids typing them onto the
 *  shared context). Cleared on close. */
const recheckTimers = new WeakMap<Peer, ReturnType<typeof setInterval>>();

export default defineWebSocketHandler({
  /** Resolve auth ONCE, here, where the upgrade request still carries the
   *  better-auth cookie. Anonymous upgrades are allowed (the socket also
   *  serves public procedures, e.g. for logged-out auth pages); we only pin a
   *  connection when a valid session is present. `authP` gates protected calls
   *  per-request, exactly as on the HTTP transport. After login/logout the
   *  client reconnects so the new upgrade re-resolves the cookie. */
  async upgrade(request) {
    const summary = await auth.api
      .getSession({ headers: request.headers })
      .catch(() => null);
    if (!summary?.user) {
      return {}; // anonymous connection — no pinned user
    }
    const connection: ConnectionAuth = {
      user: summary.user,
      session: summary.session,
      headers: new Headers(request.headers),
    };
    return { context: { connection } satisfies Partial<ORPCContext> };
  },

  open(peer) {
    const ctx = peer.context as unknown as WsPeerContext;
    // Anonymous sockets carry no session to re-check.
    if (!ctx.connection) return;
    const timer = setInterval(async () => {
      const summary = await auth.api
        .getSession({ headers: ctx.connection!.headers })
        .catch(() => null);
      if (!summary?.user) {
        peer.close(4401, "session-expired");
        return;
      }
      // Keep the pinned user/session fresh (roles, etc. may have changed).
      ctx.connection!.user = summary.user;
      ctx.connection!.session = summary.session;
    }, SESSION_RECHECK_MS);
    recheckTimers.set(peer, timer);
  },

  async message(peer, message) {
    await handler.message(peer, message, {
      context: peer.context as unknown as WsPeerContext,
    });
  },

  close(peer) {
    const timer = recheckTimers.get(peer);
    if (timer) {
      clearInterval(timer);
      recheckTimers.delete(peer);
    }
    handler.close(peer);
  },
});
