import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/authClient";
import { toggleTheme, useTheme } from "~/lib/theme";

/** Theme toggle + logout, shared by the topbar and the boards sidebar. */
export function UserActions() {
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
    <>
      <Button variant="ghost" size="icon" onClick={toggleTheme}>
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
      <Button variant="outline" size="sm" onClick={logout}>
        Log out
      </Button>
    </>
  );
}
