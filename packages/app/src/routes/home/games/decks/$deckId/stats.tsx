import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeftIcon, Trophy } from "lucide-react";
import { DeckStats } from "~/components/games/DeckStats";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/games/decks/$deckId/stats")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        rpc.game.decks.stats.queryOptions({ input: { deckId: params.deckId } }),
      );
    } catch {
      throw redirect({ to: "/home/games" });
    }
  },
});

function RouteComponent() {
  const { deckId } = Route.useParams();
  const { data: stats } = useSuspenseQuery(
    rpc.game.decks.stats.queryOptions({ input: { deckId } }),
  );

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link
        to="/home/games/decks/$deckId"
        params={{ deckId }}
        className="-ml-1 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to deck
      </Link>

      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-primary" />
        <h1 className="font-display text-2xl font-bold">Stats</h1>
        <span className="text-sm text-muted-foreground">
          {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? "" : "s"} played
        </span>
      </div>

      <DeckStats stats={stats} />
    </main>
  );
}
