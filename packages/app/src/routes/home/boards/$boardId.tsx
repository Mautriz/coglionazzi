import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PaperclipIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { CardDialog } from "~/components/boards/CardDialog";
import { TagBadge } from "~/components/boards/TagBadge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { rpc, type Outputs } from "~/lib/rpcClient";
import { cn } from "~/lib/classUtils";

export const Route = createFileRoute("/home/boards/$boardId")({
  component: RouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      rpc.board.get.queryOptions({ input: { boardId: params.boardId } }),
    ),
});

type Board = Outputs["board"]["get"];
type BoardCard = Board["columns"][number]["cards"][number];

function RouteComponent() {
  const { boardId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data: board } = useSuspenseQuery(
    rpc.board.get.queryOptions({ input: { boardId } }),
  );

  const invalidateBoard = () =>
    queryClient.invalidateQueries({
      queryKey: rpc.board.get.key({ input: { boardId } }),
    });

  const { mutate: moveCard } = useMutation(
    rpc.board.moveCard.mutationOptions({ onSuccess: invalidateBoard }),
  );

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const openCard: BoardCard | null =
    board.columns
      .flatMap((c) => c.cards)
      .find((c) => c.id === openCardId) ?? null;

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-4 py-6">
      <h1 className="font-display text-2xl font-bold">{board.name}</h1>

      <div className="flex flex-1 items-start gap-4 overflow-x-auto pb-4">
        {board.columns.map((column) => (
          <section
            key={column.id}
            className={cn(
              "flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-card-border bg-card-background p-2.5 transition-colors",
              dragOverColumn === column.id && "border-primary/60 bg-accent",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverColumn(column.id);
            }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverColumn(null);
              const cardId = e.dataTransfer.getData("cardId");
              if (cardId) moveCard({ cardId, columnId: column.id });
            }}
          >
            <header className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{column.name}</h2>
              <span className="text-xs text-muted-foreground2">
                {column.cards.length}
              </span>
            </header>

            {column.cards.map((card) => (
              <button
                key={card.id}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("cardId", card.id)}
                onClick={() => setOpenCardId(card.id)}
                className="flex cursor-grab flex-col gap-1.5 rounded-md border border-card-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary/40 active:cursor-grabbing"
              >
                <span className="text-sm">{card.title}</span>
                {(card.tags.length > 0 || card.attachments.length > 0) && (
                  <span className="flex flex-wrap items-center gap-1">
                    {card.tags.map((tag) => (
                      <TagBadge key={tag} tag={tag} />
                    ))}
                    {card.attachments.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground2">
                        <PaperclipIcon className="size-3" />
                        {card.attachments.length}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}

            <AddCard columnId={column.id} onCreated={invalidateBoard} />
          </section>
        ))}

        <AddColumn boardId={board.id} onCreated={invalidateBoard} />
      </div>

      {openCard && (
        <CardDialog
          card={openCard}
          onClose={() => setOpenCardId(null)}
          onChanged={invalidateBoard}
        />
      )}
    </main>
  );
}

function AddCard({
  columnId,
  onCreated,
}: {
  columnId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const { mutate: createCard, isPending } = useMutation(
    rpc.board.createCard.mutationOptions({
      onSuccess: () => {
        setTitle("");
        onCreated();
      },
    }),
  );

  return (
    <form
      className="flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) createCard({ columnId, title });
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a card…"
        className="h-8 text-sm"
      />
      <Button
        type="submit"
        size="icon-sm"
        variant="ghost"
        disabled={!title.trim() || isPending}
        aria-label="Add card"
      >
        <PlusIcon />
      </Button>
    </form>
  );
}

function AddColumn({
  boardId,
  onCreated,
}: {
  boardId: string;
  onCreated: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const { mutate: addColumn, isPending } = useMutation(
    rpc.board.addColumn.mutationOptions({
      onSuccess: () => {
        setName("");
        setAdding(false);
        onCreated();
      },
    }),
  );

  if (!adding) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-44 shrink-0 justify-start text-muted-foreground"
        onClick={() => setAdding(true)}
      >
        <PlusIcon />
        Add column
      </Button>
    );
  }

  return (
    <form
      className="flex w-60 shrink-0 gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) addColumn({ boardId, name });
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setAdding(false)}
        placeholder="Column name…"
        className="h-9"
      />
      <Button type="submit" disabled={!name.trim() || isPending}>
        Add
      </Button>
    </form>
  );
}
