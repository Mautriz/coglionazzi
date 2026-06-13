import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Logo } from "~/components/custom/Logo";
import { UserActions } from "~/components/custom/UserActions";

/** Protected area: everything under /home requires a session and shares the
 *  top bar + nav. The boards section adds its own left sidebar below this
 *  (routes/home/boards/route.tsx). */
export const Route = createFileRoute("/home")({
  component: RouteComponent,
  beforeLoad(ctx) {
    if (!ctx.context.user) {
      throw redirect({ to: "/auth/login" });
    }
  },
});

const NAV = [
  { to: "/home", label: "Home", exact: true },
  { to: "/home/boards", label: "Boards", exact: false },
  { to: "/home/demo", label: "Demo", exact: false },
] as const;

function RouteComponent() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="app-topbar flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-6">
          <Link to="/home">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className="rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: "bg-sidebar-accent text-sidebar-accent-foreground",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <UserActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
