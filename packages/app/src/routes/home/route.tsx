import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "~/components/custom/AppShell";

/** The app proper: Teams. Everything under /home requires a session, and the
 *  topbar carries NO section nav — Teams is the whole app here, so the header
 *  stays out of its way. The secondary area lives at /play (reached by URL);
 *  the team rail is mounted one level down, in routes/home/teams/route.tsx. */
export const Route = createFileRoute("/home")({
  component: RouteComponent,
  beforeLoad(ctx) {
    if (!ctx.context.user) {
      throw redirect({ to: "/auth/login" });
    }
  },
});

function RouteComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
