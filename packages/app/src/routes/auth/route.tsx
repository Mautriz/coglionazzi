import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Logo } from "~/components/custom/Logo";

export const Route = createFileRoute("/auth")({
  component: RouteComponent,
  beforeLoad(ctx) {
    if (ctx.context.user) {
      throw redirect({ to: "/home" });
    }
  },
});

function RouteComponent() {
  return (
    <div className="px-3 h-dvh flex flex-col gap-8 items-center justify-center">
      <Logo size="lg" />
      <Outlet />
    </div>
  );
}
