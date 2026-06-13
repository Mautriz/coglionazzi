import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { ConnectedUsersCount } from "~/components/custom/ConnectedUsersCount";
import { Logo } from "~/components/custom/Logo";
import { UserActions } from "~/components/custom/UserActions";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** Protected area: everything under /home requires a session and shares the top
 *  bar, whose nav is the app's sections. The team rail lives only in the Teams
 *  section (routes/home/teams/route.tsx). */
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
  { to: "/home/teams", label: "Teams", exact: false },
  { to: "/home/games", label: "Games", exact: false },
  { to: "/home/demo", label: "Demo", exact: false },
] as const;

function RouteComponent() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          {/* Sections collapse behind a menu on mobile (the inline nav needs
              more room than a phone has next to the actions cluster). */}
          <SectionMenu />
          <Link to="/home" className="shrink-0">
            <Logo size="sm" textClassName="hidden sm:inline" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
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
        <div className="flex items-center justify-end gap-1 sm:gap-2">
          <ConnectedUsersCount />
          <UserActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

/** The app sections as a hamburger menu — mobile only (md:hidden); the topbar
 *  shows the inline nav from `md` up. */
function SectionMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild className="md:hidden">
        <Button variant="ghost" size="icon" aria-label="Sections">
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {NAV.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link to={item.to} activeOptions={{ exact: item.exact }}>
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
