import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareIcon, PaperclipIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CardDialog } from "~/components/boards/CardDialog";
import { TagBadge } from "~/components/boards/TagBadge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { rpc, type Outputs } from "~/lib/rpcClient";
import { cn } from "~/lib/classUtils";

export const Route = createFileRoute("/home/boards/$boardId")({
  component: RouteComponent,
  // ?card=<id> opens that card's dialog — used by global search results.
  validateSearch: z.object({ card: z.string().optional() }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      rpc.board.get.queryOptions({ input: { boardId: params.boardId } }),
    ),
});

type Board = Outputs["board"]["get"];
type BoardCard = Board["columns"][number]["cards"][number];

function RouteComponent() {
  const { boardId } = Route.useParams();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const boardQuery = rpc.board.get.queryOptions({ input: { boardId } });
  const { data: board } = useSuspenseQuery(boardQuery);

  const invalidateBoard = () =>
    queryClient.invalidateQueries({ queryKey: boardQuery.queryKey });

  const { mutate: moveCard } = useMutation(
    rpc.board.moveCard.mutationOptions({ onSettled: invalidateBoard }),
  );

  const { mutate: deleteBoard, isPending: isDeletingBoard } = useMutation(
    rpc.board.deleteBoard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
        navigate({ to: "/home/boards" });
      },
    }),
  );

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);

  // Search results deep-link to a card via ?card=; consume the param into
  // local state (and drop it from the URL once handled).
  const { card: cardParam } = Route.useSearch();
  useEffect(() => {
    if (cardParam) {
      setOpenCardId(cardParam);
      navigate({ search: {}, replace: true });
    }
  }, [cardParam, navigate]);

  // A plain click must still open the card dialog — only start dragging
  // after the pointer travelled a bit.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const allCards = board.columns.flatMap((c) => c.cards);
  const openCard = allCards.find((c) => c.id === openCardId) ?? null;

  function handleDragStart(e: DragStartEvent) {
    setActiveCard(allCards.find((c) => c.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;
    const cardId = String(active.id);

    // Drop target: a column (empty space → append) or a card (take its slot).
    let targetCol = board.columns.find((c) => c.id === over.id);
    let targetIndex: number;
    if (targetCol) {
      targetIndex = targetCol.cards.filter((c) => c.id !== cardId).length;
    } else {
      targetCol = board.columns.find((c) =>
        c.cards.some((k) => k.id === over.id),
      );
      if (!targetCol) return;
      const activeIndex = targetCol.cards.findIndex((k) => k.id === cardId);
      const overIndex = targetCol.cards.findIndex((k) => k.id === over.id);
      const without = targetCol.cards.filter((k) => k.id !== cardId);
      let idx = without.findIndex((k) => k.id === over.id);
      // Moving down within the same column drops AFTER the hovered card.
      if (activeIndex !== -1 && activeIndex < overIndex) idx += 1;
      targetIndex = idx;
    }

    // Midpoint-of-neighbors keeps moves O(1) — no renumbering of siblings.
    const neighbors = targetCol.cards.filter((k) => k.id !== cardId);
    const prev = neighbors[targetIndex - 1];
    const next = neighbors[targetIndex];
    const position =
      prev && next
        ? (prev.position + next.position) / 2
        : next
          ? next.position - 1
          : prev
            ? prev.position + 1
            : 1;

    // Optimistic: place the card locally so it doesn't snap back while the
    // mutation runs; onSettled re-syncs with the server.
    const targetColId = targetCol.id;
    queryClient.setQueryData(boardQuery.queryKey, (old: Board | undefined) => {
      if (!old) return old;
      const card = old.columns
        .flatMap((c) => c.cards)
        .find((c) => c.id === cardId);
      if (!card) return old;
      return {
        ...old,
        columns: old.columns.map((col) => ({
          ...col,
          cards: [
            ...col.cards.filter((c) => c.id !== cardId),
            ...(col.id === targetColId
              ? [{ ...card, column_id: targetColId, position }]
              : []),
          ].sort((a, b) => a.position - b.position),
        })),
      };
    });

    moveCard({ cardId, columnId: targetColId, position });
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{board.name}</h1>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={isDeletingBoard}
          onClick={() => {
            if (window.confirm(`Delete board "${board.name}" and all its cards?`)) {
              deleteBoard({ boardId });
            }
          }}
        >
          <Trash2Icon />
          Delete board
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        {/* px/pt give focus rings (3px box-shadows, clipped by the scroll
            container on BOTH axes — overflow-x:auto forces overflow-y:auto)
            room to render at the container edges. */}
        <div className="flex flex-1 items-start gap-4 overflow-x-auto px-1 pt-1 pb-4">
          {board.columns.map((column) => (
            <ColumnSection
              key={column.id}
              column={column}
              isDraggingCard={activeCard !== null}
              onOpenCard={setOpenCardId}
              onCreated={invalidateBoard}
            />
          ))}

          <AddColumn boardId={board.id} onCreated={invalidateBoard} />
        </div>

        <DragOverlay>
          {activeCard && <CardVisual card={activeCard} className="rotate-2" />}
        </DragOverlay>
      </DndContext>

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

function ColumnSection({
  column,
  isDraggingCard,
  onOpenCard,
  onCreated,
}: {
  column: Board["columns"][number];
  isDraggingCard: boolean;
  onOpenCard: (cardId: string) => void;
  onCreated: () => void;
}) {
  // Columns are droppable themselves so cards can land in empty ones.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-card-border bg-card-background p-2.5 transition-colors",
        isDraggingCard && isOver && "border-primary/60 bg-accent",
      )}
    >
      <header className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">{column.name}</h2>
        <span className="text-xs text-muted-foreground2">
          {column.cards.length}
        </span>
      </header>

      <SortableContext
        items={column.cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.cards.map((card) => (
          <SortableCard key={card.id} card={card} onOpen={onOpenCard} />
        ))}
      </SortableContext>

      <AddCard columnId={column.id} onCreated={onCreated} />
    </section>
  );
}

function SortableCard({
  card,
  onOpen,
}: {
  card: BoardCard;
  onOpen: (cardId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <CardVisual
        card={card}
        onClick={() => onOpen(card.id)}
        className={cn(isDragging && "opacity-40")}
      />
    </div>
  );
}

/** Presentational card — shared by the sortable item and the drag overlay. */
function CardVisual({
  card,
  onClick,
  className,
}: {
  card: BoardCard;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-grab flex-col gap-1.5 rounded-md border border-card-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary/40 active:cursor-grabbing",
        className,
      )}
    >
      <span className="text-sm">{card.title}</span>
      {(card.tags.length > 0 ||
        card.attachments.length > 0 ||
        card.commentCount > 0) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {card.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
          {card.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground2">
              <PaperclipIcon className="size-3" />
              {card.attachments.length}
            </span>
          )}
          {card.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground2">
              <MessageSquareIcon className="size-3" />
              {card.commentCount}
            </span>
          )}
        </span>
      )}
    </button>
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
