import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
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
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  GripVerticalIcon,
  LinkIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CardDialog } from "~/components/boards/CardDialog";
import { PresenceStack } from "~/components/boards/PresenceStack";
import { TagBadge } from "~/components/boards/TagBadge";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { cardMatchesFilters, isFilterActive } from "~/lib/cardFilters";
import { useBoardRealtime } from "~/lib/useRealtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { rpc, type Outputs } from "~/lib/rpcClient";
import { cn } from "~/lib/classUtils";

export const Route = createFileRoute("/home/boards/$boardId")({
  component: RouteComponent,
  // ?card=<id> opens that card's dialog (used by global search results);
  // the rest are the board filters (see lib/cardFilters.ts), kept in the
  // URL so filtered views are shareable.
  validateSearch: z.object({
    card: z.string().optional(),
    q: z.string().optional(),
    tags: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        rpc.board.get.queryOptions({ input: { boardId: params.boardId } }),
      );
    } catch (err) {
      // Not a member of the board's team (or the board is gone) → send the
      // user back to the boards list instead of an error page.
      const code = (err as { code?: string } | null)?.code;
      if (code === "FORBIDDEN" || code === "NOT_FOUND") {
        throw redirect({ to: "/home/boards" });
      }
      throw err;
    }
  },
});

type Board = Outputs["board"]["get"];
type BoardCard = Board["columns"][number]["cards"][number];

function RouteComponent() {
  const { boardId } = Route.useParams();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const boardQuery = rpc.board.get.queryOptions({ input: { boardId } });
  const { data: board } = useSuspenseQuery(boardQuery);

  // Live updates: refetch this board whenever a teammate changes it.
  useBoardRealtime(boardId);

  const invalidateBoard = () => {
    queryClient.invalidateQueries({ queryKey: boardQuery.queryKey });
    // Sidebar card counts come from board.list.
    queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
  };

  const { mutate: moveCard } = useMutation(
    rpc.board.moveCard.mutationOptions({ onSettled: invalidateBoard }),
  );

  const { mutate: moveColumn } = useMutation(
    rpc.board.moveColumn.mutationOptions({ onSettled: invalidateBoard }),
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
  const [activeColumn, setActiveColumn] = useState<
    Board["columns"][number] | null
  >(null);

  // Search results deep-link to a card via ?card=; consume the param into
  // local state (and drop it from the URL, keeping the filter params).
  const { card: cardParam, ...filters } = Route.useSearch();
  useEffect(() => {
    if (cardParam) {
      setOpenCardId(cardParam);
      navigate({
        search: (prev) => ({ ...prev, card: undefined }),
        replace: true,
      });
    }
  }, [cardParam, navigate]);

  const filtersActive = isFilterActive(filters);
  const visibleColumns = filtersActive
    ? board.columns.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => cardMatchesFilters(c, filters)),
      }))
    : board.columns;
  const totalCards = board.columns.reduce((n, c) => n + c.cards.length, 0);
  const visibleCards = visibleColumns.reduce((n, c) => n + c.cards.length, 0);

  // A plain click must still open the card dialog — only start dragging
  // after the pointer travelled a bit.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const allCards = board.columns.flatMap((c) => c.cards);
  const openCard = allCards.find((c) => c.id === openCardId) ?? null;

  function handleDragStart(e: DragStartEvent) {
    if (e.active.data.current?.type === "column") {
      setActiveColumn(
        board.columns.find((c) => c.id === e.active.id) ?? null,
      );
    } else {
      setActiveCard(allCards.find((c) => c.id === e.active.id) ?? null);
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const wasColumn = !!activeColumn;
    setActiveCard(null);
    setActiveColumn(null);
    const { active, over } = e;
    if (!over) return;

    if (wasColumn) {
      handleColumnDrop(String(active.id), String(over.id));
      return;
    }

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

  function handleColumnDrop(columnId: string, overId: string) {
    if (columnId === overId) return;
    // `over` is another column, or a card inside one — resolve to a column.
    let overCol = board.columns.find((c) => c.id === overId);
    if (!overCol) {
      overCol = board.columns.find((c) =>
        c.cards.some((k) => k.id === overId),
      );
    }
    if (!overCol || overCol.id === columnId) return;

    const without = board.columns.filter((c) => c.id !== columnId);
    const activeIndex = board.columns.findIndex((c) => c.id === columnId);
    const overIndex = board.columns.findIndex((c) => c.id === overCol!.id);
    let idx = without.findIndex((c) => c.id === overCol!.id);
    if (activeIndex < overIndex) idx += 1;

    const prev = without[idx - 1];
    const next = without[idx];
    const position =
      prev && next
        ? (prev.position + next.position) / 2
        : next
          ? next.position - 1
          : prev
            ? prev.position + 1
            : 1;

    queryClient.setQueryData(boardQuery.queryKey, (old: Board | undefined) => {
      if (!old) return old;
      return {
        ...old,
        columns: old.columns
          .map((c) => (c.id === columnId ? { ...c, position } : c))
          .sort((a, b) => a.position - b.position),
      };
    });

    moveColumn({ columnId, position });
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-2xl font-bold">{board.name}</h1>
          {filtersActive && (
            <span className="text-sm text-muted-foreground">
              {visibleCards}/{totalCards} cards match
              <Button
                variant="link"
                size="xs"
                className="ml-1 text-link"
                onClick={() =>
                  navigate({ search: {}, replace: true })
                }
              >
                clear filters
              </Button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <PresenceStack boardId={boardId} />
          <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={isDeletingBoard}
          onClick={() => {
            if (window.confirm(`Delete board "${board.name}"? Its cards will be moved to the team archive.`)) {
              deleteBoard({ boardId });
            }
          }}
        >
          <Trash2Icon />
          Delete board
        </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveCard(null);
          setActiveColumn(null);
        }}
      >
        {/* px/pt give focus rings (3px box-shadows, clipped by the scroll
            container on BOTH axes — overflow-x:auto forces overflow-y:auto)
            room to render at the container edges. */}
        <div className="flex flex-1 items-start gap-4 overflow-x-auto px-1 pt-1 pb-4">
          <SortableContext
            items={visibleColumns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {visibleColumns.map((column) => (
              <ColumnSection
                key={column.id}
                column={column}
                isDraggingCard={activeCard !== null}
                onOpenCard={setOpenCardId}
                onChanged={invalidateBoard}
              />
            ))}
          </SortableContext>

          <AddColumn boardId={board.id} onCreated={invalidateBoard} />
        </div>

        <DragOverlay>
          {activeCard && <CardVisual card={activeCard} className="rotate-2" />}
          {activeColumn && (
            <div className="w-72 rounded-lg border border-primary/50 bg-card-background p-2.5 opacity-90">
              <div className="px-1 text-sm font-semibold">
                {activeColumn.name}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardDialog
          card={openCard}
          boardCards={allCards.map((c) => ({ id: c.id, title: c.title }))}
          teamId={board.team_id}
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
  onChanged,
}: {
  column: Board["columns"][number];
  isDraggingCard: boolean;
  onOpenCard: (cardId: string) => void;
  onChanged: () => void;
}) {
  // Sortable (column reordering) AND droppable (cards land here, incl. empty
  // columns). Drag listeners go on the header handle only, so card clicks /
  // the rename input still work.
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: column.id, data: { type: "column" } });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);

  const { mutate: renameColumn } = useMutation(
    rpc.board.renameColumn.mutationOptions({ onSuccess: onChanged }),
  );
  const { mutate: deleteColumn } = useMutation(
    rpc.board.deleteColumn.mutationOptions({ onSuccess: onChanged }),
  );

  function commitRename() {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== column.name) {
      renameColumn({ columnId: column.id, name: trimmed });
    } else {
      setName(column.name);
    }
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-card-border bg-card-background p-2.5 transition-colors",
        isDraggingCard && isOver && "border-primary/60 bg-accent",
        isDragging && "opacity-40",
      )}
    >
      <header className="group flex items-center gap-1">
        <button
          type="button"
          aria-label="Drag column"
          className="cursor-grab text-muted-foreground2 hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>

        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                setName(column.name);
                setEditing(false);
              }
            }}
            className="h-6 px-1.5 py-0 text-sm font-semibold"
          />
        ) : (
          <h2
            className="flex-1 cursor-text truncate text-sm font-semibold"
            onClick={() => setEditing(true)}
            title="Click to rename"
          >
            {column.name}
          </h2>
        )}

        <span className="text-xs text-muted-foreground2">
          {column.cards.length}
        </span>
        <button
          type="button"
          aria-label={`Delete ${column.name}`}
          onClick={() => {
            if (
              window.confirm(
                `Delete column "${column.name}"? Its ${column.cards.length} card(s) will be moved to the team archive.`,
              )
            ) {
              deleteColumn({ columnId: column.id });
            }
          }}
          className="invisible text-muted-foreground hover:text-destructive group-hover:visible"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </header>

      <SortableContext
        items={column.cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.cards.map((card) => (
          <SortableCard key={card.id} card={card} onOpen={onOpenCard} />
        ))}
      </SortableContext>

      <AddCard columnId={column.id} onCreated={onChanged} />
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
        card.commentCount > 0 ||
        card.relations.length > 0 ||
        card.assignees.length > 0) && (
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
          {card.relations.length > 0 && (
            <span
              title={
                card.relations.some((r) => r.kind === "blocked_by")
                  ? "Blocked by another card"
                  : "Linked cards"
              }
              className={cn(
                "inline-flex items-center gap-0.5 text-xs",
                card.relations.some((r) => r.kind === "blocked_by")
                  ? "text-red1"
                  : "text-muted-foreground2",
              )}
            >
              <LinkIcon className="size-3" />
              {card.relations.length}
            </span>
          )}
          {card.assignees.length > 0 && (
            <span className="ml-auto inline-flex -space-x-1.5">
              {card.assignees.slice(0, 3).map((a) => (
                <UserAvatar key={a.id} id={a.id} name={a.name} size="xs" />
              ))}
              {card.assignees.length > 3 && (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
                  +{card.assignees.length - 3}
                </span>
              )}
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
