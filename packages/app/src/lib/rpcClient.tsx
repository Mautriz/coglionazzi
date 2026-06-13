import { RPCLink as FetchRPCLink } from "@orpc/client/fetch";
import { RPCLink as WebsocketRPCLink } from "@orpc/client/websocket";
import {
  createAppClient,
  type AppClient,
  type AppClientLink,
  type AppRpc,
} from "../server/orpc/client";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { getRealtimeSocket } from "./wsClient";

export type { Outputs } from "../server/orpc/client";

// No browser globals on the server (SSR) — picks the transport below.
const isServer = typeof window === "undefined";

const getHeaders = createServerFn().handler(async () =>
  Object.fromEntries(getRequestHeaders()),
);

const builtUrl = `${import.meta.env.VITE_FRONTEND_URL}/api/rpc`;

// SSR runs beforeLoad/loaders on the server, where the RPC call is an internal
// HTTP request that does NOT carry the user's cookies by default. Forward the
// incoming document request's headers so the backend can resolve the session;
// otherwise getSession returns null and (with infinite staleTime) the client
// is locked into a logged-out state after hydration.
const ssrLink = new FetchRPCLink({
  url: builtUrl,
  async fetch(request, init) {
    const incoming = await getHeaders();
    const filtered = new Headers(incoming as HeadersInit);
    filtered.delete("upgrade");
    filtered.delete("connection");
    return fetch(request, { ...init, headers: filtered });
  },
});

// In the browser, all calls go over a single persistent WebSocket (auth is
// resolved once at the upgrade — see ws/rpcHandler.ts). Event Iterator
// procedures (board/comment/presence subscriptions) stream over the same
// socket. SSR keeps the HTTP fetch link (no socket on the server).
function createLink(): AppClientLink {
  if (isServer) return ssrLink as unknown as AppClientLink;
  const websocket = getRealtimeSocket() as unknown as WebSocket;
  return new WebsocketRPCLink({ websocket }) as unknown as AppClientLink;
}

const result = createAppClient(createLink());
export const client: AppClient = result.client;
export const rpc: AppRpc = result.rpc;
