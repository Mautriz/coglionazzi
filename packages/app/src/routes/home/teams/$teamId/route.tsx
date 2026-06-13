import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { TeamPanel } from "~/components/teams/TeamPanel";
import { rpc } from "~/lib/rpcClient";

/** A team's workspace: the global topbar + team rail stay (parent layouts);
 *  this adds the team's second-column panel (boards, chat, archive, …) and
 *  gates the whole subtree to members. */
export const Route = createFileRoute("/home/teams/$teamId")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    const teams = await context.queryClient.ensureQueryData(
      rpc.team.list.queryOptions(),
    );
    if (!teams.some((t) => t.id === params.teamId)) {
      throw redirect({ to: "/home" });
    }
  },
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  return (
    <div className="flex min-h-0 flex-1">
      <TeamPanel teamId={teamId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
