import { createFileRoute, redirect } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { rpc } from "~/lib/rpcClient";

/** Entering "Teams" with no team selected → jump to the first team, or show an
 *  empty state pointing at the rail's "+" when you're in none. */
export const Route = createFileRoute("/home/teams/")({
  component: RouteComponent,
  loader: async ({ context }) => {
    const teams = await context.queryClient.ensureQueryData(
      rpc.team.list.queryOptions(),
    );
    if (teams.length > 0) {
      throw redirect({
        to: "/home/teams/$teamId",
        params: { teamId: teams[0].id },
      });
    }
  },
});

function RouteComponent() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <UsersIcon className="size-10 text-muted-foreground2" />
      <p className="max-w-sm text-sm text-muted-foreground">
        You're not in any team yet. Create one with the{" "}
        <span className="font-medium text-foreground">+</span> in the rail on the
        left, or ask a teammate to add you.
      </p>
    </main>
  );
}
