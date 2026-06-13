import { createFileRoute } from "@tanstack/react-router";

import { RPCHandler } from "@orpc/server/fetch";
import {
  RequestHeadersPlugin,
  ResponseHeadersPlugin,
} from "@orpc/server/plugins";
import { appRouter } from "../../../server/orpc/router";
import type { ORPCContext } from "../../../server/orpc/base";

const handler = new RPCHandler<ORPCContext>(appRouter, {
  plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
});

async function serve({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/rpc",
    context: { request },
  });

  return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      ANY: ({ request }) => serve({ request }),
    },
  },
});
