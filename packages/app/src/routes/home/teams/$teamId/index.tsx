import { createFileRoute, redirect } from "@tanstack/react-router";
import { KanbanIcon } from "lucide-react";
import { rpc } from "~/lib/rpcClient";

/** Team landing: jump straight to the team's first board if it has one;
 *  otherwise show an empty state pointing at the panel's "Add board". */
export const Route = createFileRoute("/home/teams/$teamId/")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    const boards = await context.queryClient.ensureQueryData(
      rpc.board.list.queryOptions(),
    );
    const first = boards.find((b) => b.team_id === params.teamId);
    if (first) {
      throw redirect({
        to: "/home/teams/$teamId/board/$boardId",
        params: { teamId: params.teamId, boardId: first.id },
      });
    }
  },
});

function RouteComponent() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <KanbanIcon className="size-10 text-muted-foreground2" />
      <p className="text-sm text-muted-foreground">
        No boards in this team yet. Create one with{" "}
        <span className="font-medium text-foreground">Add board</span> in the
        panel — or hop into the team chat.
      </p>
    </main>
  );
}
