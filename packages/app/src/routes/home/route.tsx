import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { Logo } from "~/components/custom/Logo";
import { SearchBox } from "~/components/custom/SearchBox";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/authClient";
import { toggleTheme, useTheme } from "~/lib/theme";

/** Protected area: everything under /home requires a session and shares the
 *  top bar + nav. */
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
  { to: "/home/boards", label: "Boards" },
  { to: "/home/demo", label: "Demo" },
] as const;

function RouteComponent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();

  async function logout() {
    await authClient.signOut();
    queryClient.removeQueries();
    router.invalidate();
    router.navigate({ to: "/auth/login" });
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="app-topbar flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-6">
          <Link to="/home">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: "exact" in item && item.exact }}
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
          <SearchBox />
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
