import { WebSocket as ReconnectingWebSocket } from "partysocket";

/** Browser-only realtime socket for the oRPC websocket transport.
 *
 *  partysocket's `ReconnectingWebSocket` implements the standard WebSocket
 *  interface (`addEventListener`/`removeEventListener`/`send`/`readyState`),
 *  which is exactly the surface oRPC's websocket `RPCLink` drives — so it
 *  drops straight in and owns the reconnection/backoff/buffering. A drop looks
 *  like a normal `close` to oRPC (its ClientPeer is reusable, so TanStack
 *  Query `retry` re-issues calls over the new socket). We add just two app
 *  behaviors on top: forced re-upgrade on auth change (`reconnect()`), and
 *  stop-and-redirect when the server closes us for an expired session. */

/** Server's close code when the session is gone (see ws/rpcHandler.ts). */
const CLOSE_SESSION_EXPIRED = 4401;

let socket: ReconnectingWebSocket | null = null;

function realtimeUrl(): string {
  const { origin } = window.location;
  return `${origin.replace(/^http/, "ws")}/api/rpc-ws`;
}

/** The singleton realtime socket (browser only), created on first use. */
export function getRealtimeSocket(): ReconnectingWebSocket {
  if (!socket) {
    const ws = new ReconnectingWebSocket(realtimeUrl);
    ws.addEventListener("close", (event) => {
      // Session gone server-side: stop retrying and bounce to login (a hard
      // nav clears all client state).
      if ((event as CloseEvent).code === CLOSE_SESSION_EXPIRED) {
        ws.close();
        window.location.assign("/auth/login");
      }
    });
    socket = ws;
  }
  return socket;
}

/** Re-upgrade the realtime socket NOW so it picks up the current auth cookie.
 *  Call after login/signup (so the new connection is authenticated) and after
 *  logout (so the server drops the old authenticated connection at once,
 *  rather than waiting for the periodic re-check). The RPCLink keeps the same
 *  object — partysocket swaps the underlying socket beneath it. */
export function reconnectRealtimeSocket() {
  socket?.reconnect();
}
