import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

/** Protected area: everything under /home requires a session. */
export const Route = createFileRoute("/home")({
  component: Outlet,
  beforeLoad(ctx) {
    if (!ctx.context.user) {
      throw redirect({ to: "/auth/login" });
    }
  },
});
