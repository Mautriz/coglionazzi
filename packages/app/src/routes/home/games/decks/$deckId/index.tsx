import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BarChart3Icon,
  CopyIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewGameDialog } from "~/components/games/NewGameDialog";
import { UploadButton } from "~/components/custom/FileUploads";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { rpc, type Outputs } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/games/decks/$deckId/")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        rpc.game.decks.get.queryOptions({ input: { deckId: params.deckId } }),
      );
    } catch {
      throw redirect({ to: "/home/games" });
    }
  },
});

type Deck = Outputs["game"]["decks"]["get"];
type DeckCard = Deck["cards"][number];

function RouteComponent() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deckQuery = rpc.game.decks.get.queryOptions({ input: { deckId } });
  const { data: deck } = useSuspenseQuery(deckQuery);
  const editable = deck.isMine;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: deckQuery.queryKey });
    queryClient.invalidateQueries({ queryKey: rpc.game.decks.list.key() });
  };

  const { mutate: updateDeck } = useMutation(
    rpc.game.decks.update.mutationOptions({ onSuccess: refresh }),
  );
  const { mutate: addCard } = useMutation(
    rpc.game.decks.addCard.mutationOptions({ onSuccess: refresh }),
  );
  const { mutate: cloneDeck, isPending: isCloning } = useMutation(
    rpc.game.decks.clone.mutationOptions({
      onSuccess: ({ id }) => {
        toast.success("Deck cloned");
        queryClient.invalidateQueries({ queryKey: rpc.game.decks.list.key() });
        navigate({ to: "/home/games/decks/$deckId", params: { deckId: id } });
      },
    }),
  );
  const { mutate: deleteDeck } = useMutation(
    rpc.game.decks.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Deck deleted");
        queryClient.invalidateQueries({ queryKey: rpc.game.decks.list.key() });
        navigate({ to: "/home/games" });
      },
    }),
  );

  const [playing, setPlaying] = useState(false);

  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 py-6 sm:px-8">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => navigate({ to: "/home/games" })}
        >
          <ArrowLeftIcon />
          Games
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/home/games/decks/$deckId/stats" params={{ deckId }}>
              <BarChart3Icon />
              Stats
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isCloning}
            onClick={() => cloneDeck({ deckId })}
          >
            <CopyIcon />
            Clone
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={deck.cards.length < 2}
            onClick={() => setPlaying(true)}
          >
            <PlayIcon />
            Play
          </Button>
        </div>
      </div>

      {playing && (
        <NewGameDialog deckId={deckId} onClose={() => setPlaying(false)} />
      )}

      <DeckHeader
        deck={deck}
        editable={editable}
        onSave={(patch) => updateDeck({ deckId, ...patch })}
      />

      <div className="flex items-center justify-between">
        <Label className="text-base">
          Images{" "}
          <span className="text-sm font-normal text-muted-foreground2">
            ({deck.cards.length})
          </span>
        </Label>
        {editable && (
          <UploadButton
            size="sm"
            onUploaded={(file) =>
              addCard({ deckId, fileId: file.id, title: file.name })
            }
          />
        )}
      </div>

      {deck.cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground">
          {editable
            ? "No images yet — upload a few. You need at least 2 to play (and a power of 2 to fill a bracket). Not your deck? Clone it to make it editable."
            : "This deck has no images yet."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {deck.cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              editable={editable}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {editable && (
        <div className="mt-4 border-t border-card-border pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm(`Delete deck "${deck.name}"? This can't be undone.`)) {
                deleteDeck({ deckId });
              }
            }}
          >
            <Trash2Icon />
            Delete deck
          </Button>
        </div>
      )}
    </main>
  );
}

function DeckHeader({
  deck,
  editable,
  onSave,
}: {
  deck: Deck;
  editable: boolean;
  onSave: (patch: { name?: string; description?: string | null }) => void;
}) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");

  if (!editable) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold">{deck.name}</h1>
        {deck.description && (
          <p className="text-sm text-muted-foreground">{deck.description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== deck.name && onSave({ name })}
        placeholder="Deck name"
        className="text-lg! font-semibold"
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() =>
          description !== (deck.description ?? "") &&
          onSave({ description: description.trim() || null })
        }
        placeholder="Description (optional)"
        className="text-sm"
      />
    </div>
  );
}

function CardTile({
  card,
  editable,
  onChanged,
}: {
  card: DeckCard;
  editable: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");

  const { mutate: updateCard } = useMutation(
    rpc.game.decks.updateCard.mutationOptions(),
  );
  const { mutate: removeCard } = useMutation(
    rpc.game.decks.removeCard.mutationOptions({ onSuccess: onChanged }),
  );

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-card-border bg-card-background p-2.5">
      <div className="relative aspect-video overflow-hidden rounded-md bg-muted">
        <img
          src={card.url}
          alt={card.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {editable && (
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => removeCard({ cardId: card.id })}
            className="absolute right-1 top-1 hidden rounded-md bg-background/80 p-1 text-destructive group-hover:block"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      {editable ? (
        <>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() =>
              title.trim() &&
              title !== card.title &&
              updateCard({ cardId: card.id, title })
            }
            placeholder="Title"
            className="h-8 text-sm font-medium"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description !== (card.description ?? "") &&
              updateCard({
                cardId: card.id,
                description: description.trim() || null,
              })
            }
            placeholder="Description (optional)"
            className="h-8 text-xs"
          />
        </>
      ) : (
        <>
          <span className="truncate text-sm font-medium">{card.title}</span>
          {card.description && (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {card.description}
            </span>
          )}
        </>
      )}
    </div>
  );
}
