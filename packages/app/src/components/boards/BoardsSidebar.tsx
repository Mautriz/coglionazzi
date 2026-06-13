import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { FilterIcon, KanbanIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { TagBadge } from "~/components/boards/TagBadge";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { DatePicker } from "~/components/custom/DatePicker";
import { SearchBox } from "~/components/custom/SearchBox";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/classUtils";
import { isFilterActive, type CardFilters } from "~/lib/cardFilters";
import { rpc } from "~/lib/rpcClient";

/** Boards-specific left rail, rendered UNDER the global topbar: board list
 *  + creation now, filters next. `data-sidebar="sidebar"` opts into the
 *  brand-tinted chrome the theme defines for sidebars. */
export function BoardsSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // undefined outside a specific board (e.g. on /home/boards).
  const { boardId } = useParams({ strict: false });

  const { data: boards } = useQuery(rpc.board.list.queryOptions());

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { mutate: createBoard, isPending } = useMutation(
    rpc.board.create.mutationOptions({
      onSuccess: (board) => {
        setName("");
        setCreating(false);
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
        navigate({
          to: "/home/boards/$boardId",
          params: { boardId: board.id },
        });
      },
    }),
  );

  return (
    <aside
      data-sidebar="sidebar"
      className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground max-md:hidden"
    >
      <div className="pb-2">
        <SearchBox />
      </div>

      <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
        Boards
      </h2>

      {boards?.map((board) => (
        <Link
          key={board.id}
          to="/home/boards/$boardId"
          params={{ boardId: board.id }}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            board.id === boardId &&
              "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
          )}
        >
          <KanbanIcon className="size-4 shrink-0" />
          <span className="truncate">{board.name}</span>
          <span className="ml-auto text-xs text-muted-foreground2">
            {board.cardCount}
          </span>
        </Link>
      ))}

      {creating ? (
        <form
          className="px-1 py-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createBoard({ name });
          }}
        >
          <Input
            autoFocus
            value={name}
            disabled={isPending}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setCreating(false)}
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            placeholder="Board name + Enter"
            className="h-7 text-sm"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PlusIcon className="size-4" />
          New board
        </button>
      )}

      {boardId && <BoardFilters boardId={boardId} />}
    </aside>
  );
}

/** Filters for the open board. State lives in the board route's search
 *  params (see lib/cardFilters.ts) so the view is shareable. */
function BoardFilters({ boardId }: { boardId: string }) {
  const navigate = useNavigate();
  const search: CardFilters & { card?: string } = useSearch({
    strict: false,
  });

  const { data: board } = useQuery(
    rpc.board.get.queryOptions({ input: { boardId } }),
  );

  const allTags = [
    ...new Set(
      board?.columns.flatMap((col) => col.cards.flatMap((c) => c.tags)) ?? [],
    ),
  ].sort();

  function patch(p: Partial<CardFilters>) {
    navigate({
      to: "/home/boards/$boardId",
      params: { boardId },
      search: (prev) => {
        const next = { ...prev, ...p };
        // Drop empties so the URL stays clean.
        for (const k of ["q", "tags", "assignees", "from", "to"] as const) {
          const v = next[k];
          if (!v || (Array.isArray(v) && v.length === 0)) delete next[k];
        }
        return next;
      },
      replace: true,
    });
  }

  const toggle = (list: string[] | undefined, value: string) =>
    list?.includes(value)
      ? list.filter((v) => v !== value)
      : [...(list ?? []), value];

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-sidebar-border pt-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
          <FilterIcon className="size-3" />
          Filters
        </h2>
        {isFilterActive(search) && (
          <Button
            variant="link"
            size="xs"
            className="text-link"
            onClick={() =>
              patch({
                q: undefined,
                tags: undefined,
                assignees: undefined,
                from: undefined,
                to: undefined,
              })
            }
          >
            clear
          </Button>
        )}
      </div>

      <Input
        value={search.q ?? ""}
        onChange={(e) => patch({ q: e.target.value || undefined })}
        placeholder="Filter by text…"
        className="h-7 text-sm"
      />

      {allTags.length > 0 && (
        <div className="flex flex-col gap-1.5 px-1">
          <Label className="text-xs text-muted-foreground">Tags</Label>
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => patch({ tags: toggle(search.tags, tag) })}
              >
                <TagBadge
                  tag={tag}
                  className={cn(
                    "cursor-pointer",
                    !search.tags?.includes(tag) && "opacity-50",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 px-1">
        <Label className="text-xs text-muted-foreground">Assignees</Label>
        <AssigneeCombobox
          selected={search.assignees ?? []}
          onChange={(ids) => patch({ assignees: ids })}
          placeholder="Filter by assignee…"
        />
      </div>

      <div className="flex flex-col gap-1.5 px-1">
        <Label className="text-xs text-muted-foreground">Created</Label>
        <div className="flex items-center gap-1.5">
          <DatePicker
            value={search.from}
            onChange={(v) => patch({ from: v })}
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground2">→</span>
          <DatePicker
            value={search.to}
            onChange={(v) => patch({ to: v })}
            placeholder="To"
          />
        </div>
      </div>
    </div>
  );
}
