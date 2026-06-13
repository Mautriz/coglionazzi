import { RPCLink } from "@orpc/client/fetch";
import {
  createAppClient,
  type AppClient,
  type AppRpc,
} from "../server/orpc/client";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { isServer } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

export type { Outputs } from "../server/orpc/client";

const getHeaders = createServerFn().handler(async () =>
  Object.fromEntries(getRequestHeaders()),
);

const builtUrl = `${import.meta.env.VITE_FRONTEND_URL}/api/rpc`;

// SSR runs beforeLoad/loaders on the server, where the RPC call is an internal
// HTTP request that does NOT carry the user's cookies by default. Forward the
// incoming document request's headers so the backend can resolve the session;
// otherwise getSession returns null and (with infinite staleTime) the client
// is locked into a logged-out state after hydration.
const link = new RPCLink({
  url: isServer ? builtUrl : `${window.location.origin}/api/rpc`,

  async fetch(request, init) {
    let headers: HeadersInit = request.headers;
    if (isServer) {
      const incoming = await getHeaders();
      const filtered = new Headers(incoming as HeadersInit);
      filtered.delete("upgrade");
      filtered.delete("connection");
      headers = filtered;
    }
    return fetch(request, {
      ...init,
      headers,
    });
  },
});

const result = createAppClient(link);
export const client: AppClient = result.client;
export const rpc: AppRpc = result.rpc;
