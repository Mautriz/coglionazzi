import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KanbanIcon, MessageSquareIcon, SearchIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { rpc } from "~/lib/rpcClient";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Global fuzzy search (boards / cards / comments) for the topbar. Results
 *  navigate to the board; card and comment hits open the card dialog via
 *  the board route's ?card= param. */
export function SearchBox() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounced(query.trim(), 250);

  const { data: results, isFetching } = useQuery({
    ...rpc.search.global.queryOptions({
      input: { query: debouncedQuery },
    }),
    enabled: debouncedQuery.length >= 2,
    placeholderData: (prev) => prev,
  });

  const hasResults =
    !!results &&
    results.boards.length + results.cards.length + results.comments.length > 0;

  function go(boardId: string, cardId?: string) {
    setOpen(false);
    setQuery("");
    navigate({
      to: "/home/boards/$boardId",
      params: { boardId },
      search: cardId ? { card: cardId } : {},
    });
  }

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so result onMouseDown/click wins over the blur-close.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Search boards, cards, comments…"
        className="h-8 pl-8 text-sm"
      />

      {open && debouncedQuery.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto rounded-md border border-card-border bg-popover p-1 shadow-lg">
          {!hasResults && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              {isFetching ? "Searching…" : "Nothing found"}
            </p>
          )}

          {results?.boards.map((board) => (
            <ResultRow
              key={board.id}
              icon={<KanbanIcon className="size-3.5 shrink-0 text-primary" />}
              title={board.name}
              subtitle="Board"
              onPick={() => go(board.id)}
            />
          ))}

          {results?.cards.map((card) => (
            <ResultRow
              key={card.id}
              icon={<SquareIcon className="size-3.5 shrink-0 text-primary" />}
              title={card.title}
              subtitle={`${card.boardName}${card.snippet ? ` — ${card.snippet}` : ""}`}
              onPick={() => go(card.boardId, card.id)}
            />
          ))}

          {results?.comments.map((comment) => (
            <ResultRow
              key={comment.id}
              icon={
                <MessageSquareIcon className="size-3.5 shrink-0 text-primary" />
              }
              title={`${comment.author ?? "ghost"} on "${comment.cardTitle}"`}
              subtitle={comment.snippet}
              onPick={() => go(comment.boardId, comment.cardId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  onPick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      // onMouseDown fires before the input's blur-close timer.
      onMouseDown={onPick}
      className="flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left hover:bg-accent"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
