/// <reference types="vite/client" />
import { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import * as React from "react";
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary";
import { NotFound } from "~/components/NotFound";
import { Toaster } from "~/components/ui/sonner";
import { rpc } from "../lib/rpcClient";
import { themeInitScript } from "../lib/theme";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  context: () => ({}) as { queryClient: QueryClient },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Coglionazzi",
      },
      {
        name: "description",
        content: "Games, puzzles and rankings for the crew.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  beforeLoad: async (ctx) => {
    // Resolve the session once and cache it forever; login/signup/logout
    // explicitly clear the query cache and invalidate the router.
    try {
      const summary = await ctx.context.queryClient.ensureQueryData(
        rpc.auth.getSession.queryOptions({
          gcTime: Infinity,
          staleTime: Infinity,
        }),
      );
      return { ...summary };
    } catch {
      return {};
    }
  },
  errorComponent: (props) => <DefaultCatchBoundary {...props} />,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
  component: () => <Outlet />,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
