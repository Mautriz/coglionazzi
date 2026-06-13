import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import { MessageThread } from "~/components/custom/MessageThread";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/teams/$teamId/chat")({
  component: RouteComponent,
  // Open (find-or-create) the team room up front so non-members are bounced
  // before the view renders.
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(
        rpc.chat.open.queryOptions({
          input: { ref: { scope: "team", teamId: params.teamId } },
        }),
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "FORBIDDEN" || code === "NOT_FOUND") {
        throw redirect({ to: "/home" });
      }
      throw err;
    }
  },
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const name = teams?.find((t) => t.id === teamId)?.name ?? "Team";

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-3 p-4 py-6">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
        <MessagesSquareIcon className="size-6 text-primary" />
        {name} chat
      </h1>
      <MessageThread
        key={teamId}
        roomRef={{ scope: "team", teamId }}
        emptyText="No messages yet — say hi."
      />
    </main>
  );
}
