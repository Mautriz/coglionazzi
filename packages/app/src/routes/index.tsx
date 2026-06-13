import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad(ctx) {
    if (ctx.context.user) {
      throw redirect({ to: "/home" });
    }
    throw redirect({ to: "/auth/login" });
  },
});
