import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  KanbanIcon,
  MessagesSquareIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { TeamAvatar } from "~/components/custom/TeamAvatar";
import { MessageThread } from "~/components/custom/MessageThread";
import { Input } from "~/components/ui/input";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/")({
  component: RouteComponent,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(rpc.team.list.queryOptions()),
      context.queryClient.ensureQueryData(rpc.board.list.queryOptions()),
    ]),
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { data: teams } = useSuspenseQuery(rpc.team.list.queryOptions());
  const { data: boards } = useSuspenseQuery(rpc.board.list.queryOptions());
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState("");

  const { mutate: createTeam, isPending } = useMutation(
    rpc.team.create.mutationOptions({
      onSuccess: () => {
        setTeamName("");
        setCreating(false);
        queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
      },
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-8 p-4 py-8">
      <h1 className="font-display text-2xl font-bold">Ciao, {user?.name} 👋</h1>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <UsersIcon className="size-5 text-primary" />
          Your teams
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const count = boards.filter((b) => b.team_id === team.id).length;
            return (
              <Link
                key={team.id}
                to="/home/teams/$teamId"
                params={{ teamId: team.id }}
                className="flex flex-col gap-3 rounded-lg border border-card-border bg-card-background p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center gap-3">
                  <TeamAvatar id={team.id} name={team.name} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-display font-semibold">
                      {team.name}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground2">
                      <UsersIcon className="size-3" />
                      {team.memberCount} member
                      {team.memberCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <KanbanIcon className="size-4" />
                  {count} board{count === 1 ? "" : "s"}
                </span>
              </Link>
            );
          })}

          {creating ? (
            <form
              className="flex items-center rounded-lg border border-dashed border-card-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (teamName.trim()) createTeam({ name: teamName });
              }}
            >
              <Input
                autoFocus
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                onBlur={() => !teamName.trim() && setCreating(false)}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
                placeholder="Team name + Enter"
                className="h-8 text-sm"
                disabled={isPending}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-card-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <PlusIcon className="size-4" />
              New team
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <MessagesSquareIcon className="size-5 text-primary" />
          Global chat
        </h2>
        <MessageThread roomRef={{ scope: "global" }} emptyText="Say hi 👋" />
      </section>
    </main>
  );
}
