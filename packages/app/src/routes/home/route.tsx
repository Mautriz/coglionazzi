import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Logo } from "~/components/custom/Logo";
import { UserActions } from "~/components/custom/UserActions";
import { TeamRail } from "~/components/teams/TeamRail";

/** Protected area: everything under /home requires a session and shares the
 *  top bar + the global team rail (routes/home/teams/$teamId adds the team's
 *  second-column panel below this). */
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
    <div className="flex h-dvh flex-col">
      <header className="app-topbar flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
        <Link to="/home" className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="flex flex-1 items-center justify-end gap-3">
          <Link
            to="/home/demo"
            className="rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeProps={{
              className: "bg-sidebar-accent text-sidebar-accent-foreground",
            }}
          >
            Demo
          </Link>
          <UserActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <TeamRail />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
