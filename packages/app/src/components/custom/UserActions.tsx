import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/authClient";
import { rpc } from "~/lib/rpcClient";
import { reconnectRealtimeSocket } from "~/lib/wsClient";
import { toggleTheme, useTheme } from "~/lib/theme";
import { BrandPicker } from "~/components/custom/BrandPicker";

/** Theme toggle + logout, shared by the topbar and the boards sidebar. */
export function UserActions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  // The session is resolved once in __root and cached forever — read it here.
  const { data: session } = useQuery(
    rpc.auth.getSession.queryOptions({ staleTime: Infinity }),
  );
  const me = session?.user;

  async function logout() {
    await authClient.signOut();
    // Re-upgrade the (now cookie-less) socket so the server drops the
    // authenticated connection at once, rather than waiting for the re-check.
    // Wait for the re-open before invalidating so oRPC calls don't race the
    // reconnect gap.
    await reconnectRealtimeSocket();
    queryClient.removeQueries();
    router.invalidate();
    router.navigate({ to: "/auth/login" });
  }

  return (
    <>
      <BrandPicker />
      <Button variant="ghost" size="icon" onClick={toggleTheme}>
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
      {me && (
        <UserAvatar
          id={me.id}
          name={me.name ?? "Me"}
          image={me.image}
          className="ml-1"
        />
      )}
      <Button variant="outline" size="sm" onClick={logout}>
        Log out
      </Button>
    </>
  );
}
