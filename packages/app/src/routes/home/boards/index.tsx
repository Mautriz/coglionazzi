import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/boards/")({
  component: RouteComponent,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(rpc.board.list.queryOptions()),
});

function RouteComponent() {
  const { data: boards } = useSuspenseQuery(rpc.board.list.queryOptions());
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const { mutate: createBoard, isPending } = useMutation(
    rpc.board.create.mutationOptions({
      onSuccess: () => {
        setName("");
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
      },
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
      <h1 className="font-display text-2xl font-bold">Boards</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createBoard({ name });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New board name…"
          className="max-w-xs"
        />
        <Button type="submit" disabled={!name.trim() || isPending}>
          <PlusIcon />
          Create
        </Button>
      </form>

      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No boards yet — create the first one.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <Link
              key={board.id}
              to="/home/boards/$boardId"
              params={{ boardId: board.id }}
            >
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent>
                  <CardTitle className="mb-1">{board.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {board.cardCount} card{board.cardCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
