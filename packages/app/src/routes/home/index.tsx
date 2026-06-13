import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { Logo } from "~/components/custom/Logo";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/authClient";
import { toggleTheme, useTheme } from "~/lib/theme";

export const Route = createFileRoute("/home/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
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
      <header className="app-topbar flex items-center justify-between border-b px-4 py-3">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-[560px]">
          <CardContent>
            <CardTitle className="mb-4">Ciao, {user?.name} 👋</CardTitle>
            <p className="text-muted-foreground">
              Welcome to coglionazzi. Games, puzzles and rankings land here
              soon.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
