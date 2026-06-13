import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { toast } from "sonner";
import { Spinner } from "~/components/custom/loadingSpinner";
import { NotFound } from "./components/NotFound";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30_000,
        staleTime: 1_000,
      },
    },
    queryCache: new QueryCache({
      onError(error, _query) {
        toast("Request error", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      },
    }),
    mutationCache: new MutationCache({
      onError(error, _variables, _context, _mutation) {
        toast("Request error", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      },
    }),
  });

  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultNotFoundComponent: () => <NotFound />,
    defaultPendingComponent: () => (
      <div className="grid h-dvh place-items-center">
        <Spinner />
      </div>
    ),
    scrollRestoration: true,
    context: {
      queryClient,
    },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}
