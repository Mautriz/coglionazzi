import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  GamepadIcon,
  ImageIcon,
  LayersIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  Trophy,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { NewGameDialog } from "~/components/games/NewGameDialog";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/classUtils";
import { rpc } from "~/lib/rpcClient";
import { useGameLobbies } from "~/lib/useRealtime";

export const Route = createFileRoute("/home/games/")({
  component: RouteComponent,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(rpc.game.decks.list.queryOptions()),
      context.queryClient.ensureQueryData(rpc.game.sessions.list.queryOptions()),
    ]),
});

function RouteComponent() {
  const { data: decks } = useSuspenseQuery(rpc.game.decks.list.queryOptions());
  const { data: lobbies } = useSuspenseQuery(
    rpc.game.sessions.list.queryOptions(),
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [playDeckId, setPlayDeckId] = useState<string | null>(null);
  // New lobbies (and started/finished/reaped ones) update the list live.
  useGameLobbies();

  const { mutate: createDeck, isPending } = useMutation(
    rpc.game.decks.create.mutationOptions({
      onSuccess: ({ id }) => {
        queryClient.invalidateQueries({ queryKey: rpc.game.decks.list.key() });
        navigate({ to: "/home/games/decks/$deckId", params: { deckId: id } });
      },
    }),
  );

  return (
    <main className="flex w-full flex-1 flex-col gap-8 p-4 py-8 sm:px-8">
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-primary" />
        <h1 className="font-display text-2xl font-bold">Games</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <GamepadIcon className="size-5 text-primary" />
          Open lobbies
        </h2>
        {lobbies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-card-border p-5 text-center text-sm text-muted-foreground">
            No games running. Start one from a deck below.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {lobbies.map((s) => (
              <Link
                key={s.id}
                to="/home/games/$sessionId"
                params={{ sessionId: s.id }}
                className="flex items-center gap-3 rounded-lg border border-card-border bg-card-background px-4 py-3 transition-colors hover:border-primary/40"
              >
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    s.status === "active"
                      ? "bg-green1/15 text-green1"
                      : "bg-primary/15 text-primary",
                  )}
                >
                  {s.status === "active" ? "Live" : "Lobby"}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{s.deckName}</span>
                  <span className="text-xs text-muted-foreground2">
                    {s.hostName ? `by ${s.hostName}` : "Versus"}
                  </span>
                </span>
                {s.visibility === "private" && (
                  <LockIcon className="size-3.5 text-muted-foreground2" />
                )}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground2">
                  <UsersIcon className="size-3.5" />
                  {s.playerCount}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <LayersIcon className="size-5 text-primary" />
            Decks
          </h2>
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => createDeck({ name: "New deck" })}
          >
            <PlusIcon />
            New deck
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          A deck is a set of images. Build one, then run a Versus
          (left/right bracket) on it — more games soon.
        </p>

        {decks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground">
            No decks yet. Create one to get started.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-card-border bg-card-background transition-colors hover:border-primary/40"
              >
                <Link
                  to="/home/games/decks/$deckId"
                  params={{ deckId: deck.id }}
                  className="flex flex-col"
                >
                  <DeckPreview previews={deck.previews} />
                  <div className="flex flex-col gap-1.5 p-4">
                    <span className="font-display font-semibold group-hover:text-primary">
                      {deck.name}
                    </span>
                    {deck.description && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {deck.description}
                      </span>
                    )}
                    <span className="flex items-center gap-3 text-xs text-muted-foreground2">
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon className="size-3.5" />
                        {deck.cardCount} image{deck.cardCount === 1 ? "" : "s"}
                      </span>
                      {deck.creatorName && <span>by {deck.creatorName}</span>}
                    </span>
                  </div>
                </Link>
                <div className="px-4 pb-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={deck.cardCount < 2}
                    onClick={() => setPlayDeckId(deck.id)}
                  >
                    <PlayIcon />
                    Play
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {playDeckId && (
        <NewGameDialog
          deckId={playDeckId}
          onClose={() => setPlayDeckId(null)}
        />
      )}
    </main>
  );
}

/** Up to a 2×2 cover collage of a deck's first images. The OUTER box owns the
 *  16:9 aspect + clips overflow; children fill it with `h-full` — never put the
 *  aspect ratio on a grid whose children are `h-full` (circular height → the
 *  natural image size wins and the card balloons). */
function DeckPreview({ previews }: { previews: string[] }) {
  return (
    <div className="aspect-video w-full shrink-0 overflow-hidden bg-muted">
      {previews.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="size-8 text-muted-foreground2" />
        </div>
      ) : previews.length === 1 ? (
        <img
          src={previews[0]}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
          {previews.slice(0, 4).map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}
