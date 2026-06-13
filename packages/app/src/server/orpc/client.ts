import type { RouterClient } from "@orpc/server";
import type {
  ClientLink,
  InferClientContext,
  InferClientOutputs,
} from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import type { RouterUtils } from "@orpc/tanstack-query";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { appRouter } from "./router";

type AppRouter = typeof appRouter;

export type AppClient = RouterClient<AppRouter>;
export type AppRpc = RouterUtils<AppClient>;
export type AppClientLink = ClientLink<InferClientContext<AppClient>>;
export type Outputs = InferClientOutputs<AppClient>;

export function createAppClient(link: AppClientLink): {
  client: AppClient;
  rpc: AppRpc;
} {
  const client: AppClient = createORPCClient(link);
  const rpc: AppRpc = createTanstackQueryUtils(client, {});
  return { client, rpc };
}
