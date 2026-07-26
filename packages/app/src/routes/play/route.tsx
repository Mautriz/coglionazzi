import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { AppShell } from "~/components/custom/AppShell";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** The secondary area: global chat, the Versus game and the component
 *  playground — stuff to mess about with, deliberately off the main app.
 *  There is no link into /play from Teams; you get here by URL. Which is why
 *  this shell (unlike /home) DOES keep a section nav — it's the only way to
 *  move around once you're in. The logo leads back to Teams. */
export const Route = createFileRoute("/play")({
  component: RouteComponent,
  beforeLoad(ctx) {
    if (!ctx.context.user) {
      throw redirect({ to: "/auth/login" });
    }
  },
});

const NAV = [
  { to: "/play", label: "Chat", exact: true },
  { to: "/play/games", label: "Games", exact: false },
  { to: "/play/demo", label: "Demo", exact: false },
] as const;

function RouteComponent() {
  return (
    <AppShell nav={<SectionNav />} menu={<SectionMenu />}>
      <Outlet />
    </AppShell>
  );
}

/** Inline section links — from `md` up; below that they're in the menu. */
function SectionNav() {
  return (
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
  );
}

/** The same sections as a hamburger — mobile only (md:hidden); the inline nav
 *  needs more room than a phone has next to the actions cluster. */
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
