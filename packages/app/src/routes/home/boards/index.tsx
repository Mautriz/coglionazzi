import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/boards/")({
  component: RouteComponent,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(rpc.team.list.queryOptions()),
      context.queryClient.ensureQueryData(rpc.board.list.queryOptions()),
    ]),
});

function RouteComponent() {
  const { data: teams } = useSuspenseQuery(rpc.team.list.queryOptions());
  const { data: boards } = useSuspenseQuery(rpc.board.list.queryOptions());
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState("");

  const { mutate: createTeam, isPending } = useMutation(
    rpc.team.create.mutationOptions({
      onSuccess: () => {
        setTeamName("");
        queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
      },
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Teams &amp; boards</h1>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (teamName.trim()) createTeam({ name: teamName });
        }}
      >
        <Input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="New team name…"
          className="max-w-xs"
        />
        <Button type="submit" disabled={!teamName.trim() || isPending}>
          <PlusIcon />
          New team
        </Button>
      </form>

      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You're not in any team yet — create one above, or ask a teammate to
          add you.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {teams.map((team) => {
            const teamBoards = boards.filter((b) => b.team_id === team.id);
            return (
              <section key={team.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">
                    {team.name}
                  </h2>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground2">
                    <UsersIcon className="size-3.5" />
                    {team.memberCount}
                  </span>
                </div>
                {teamBoards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No boards in this team yet.
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {teamBoards.map((board) => (
                      <Link
                        key={board.id}
                        to="/home/boards/$boardId"
                        params={{ boardId: board.id }}
                      >
                        <Card className="h-full transition-colors hover:border-primary/40">
                          <CardContent>
                            <CardTitle className="mb-1">{board.name}</CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {board.cardCount} card
                              {board.cardCount === 1 ? "" : "s"}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
