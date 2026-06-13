import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { KanbanIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/classUtils";
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
    </aside>
  );
}
