import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  ArchiveIcon,
  KanbanIcon,
  PlusIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { CardFiltersPanel } from "~/components/boards/CardFiltersPanel";
import { TeamDialog } from "~/components/boards/TeamDialog";
import { SearchBox } from "~/components/custom/SearchBox";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/classUtils";
import { mergeFilters, type CardFilters } from "~/lib/cardFilters";
import { rpc, type Outputs } from "~/lib/rpcClient";
import { useWorkspaceRealtime } from "~/lib/useRealtime";

type Team = Outputs["team"]["list"][number];
type Board = Outputs["board"]["list"][number];

/** Boards-specific left rail, rendered UNDER the global topbar: search,
 *  boards grouped by team, and (when a board is open) its filters.
 *  `data-sidebar="sidebar"` opts into the brand-tinted chrome the theme
 *  defines for sidebars. */
export function BoardsSidebar() {
  const queryClient = useQueryClient();
  // undefined outside a specific board (e.g. on /home/boards). On the archive
  // route the param is `teamId` instead.
  const { boardId, teamId: archiveTeamId } = useParams({ strict: false });

  // Live: refetch teams/boards when a teammate adds/removes a board, changes
  // membership, or renames/deletes a team.
  useWorkspaceRealtime();

  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const { data: boards } = useQuery(rpc.board.list.queryOptions());

  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamName, setTeamName] = useState("");

  const { mutate: createTeam } = useMutation(
    rpc.team.create.mutationOptions({
      onSuccess: () => {
        setTeamName("");
        setCreatingTeam(false);
        queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
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

      {teams?.map((team) => (
        <TeamSection
          key={team.id}
          team={team}
          boards={boards?.filter((b) => b.team_id === team.id) ?? []}
          activeBoardId={boardId}
          activeArchiveTeamId={archiveTeamId}
          onSettings={() => setSettingsTeam(team)}
        />
      ))}

      {creatingTeam ? (
        <form
          className="px-1 py-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (teamName.trim()) createTeam({ name: teamName });
          }}
        >
          <Input
            autoFocus
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            onBlur={() => !teamName.trim() && setCreatingTeam(false)}
            onKeyDown={(e) => e.key === "Escape" && setCreatingTeam(false)}
            placeholder="Team name + Enter"
            className="h-7 text-sm"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreatingTeam(true)}
          className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PlusIcon className="size-4" />
          New team
        </button>
      )}

      {boardId && <BoardFilters boardId={boardId} />}

      {settingsTeam && (
        <TeamDialog team={settingsTeam} onClose={() => setSettingsTeam(null)} />
      )}
    </aside>
  );
}

/** One team: header (name + member count + settings), its boards, and an
 *  inline "add board" scoped to the team. */
function TeamSection({
  team,
  boards,
  activeBoardId,
  activeArchiveTeamId,
  onSettings,
}: {
  team: Team;
  boards: Board[];
  activeBoardId?: string;
  activeArchiveTeamId?: string;
  onSettings: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { mutate: createBoard } = useMutation(
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
    <div className="mt-2 flex flex-col gap-0.5">
      <div className="group flex items-center gap-1 px-2 pb-0.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
          {team.name}
          <span className="inline-flex items-center gap-0.5 normal-case">
            <UsersIcon className="size-3" />
            {team.memberCount}
          </span>
        </h2>
        <button
          type="button"
          aria-label={`${team.name} settings`}
          onClick={onSettings}
          className="invisible ml-auto text-muted-foreground hover:text-foreground group-hover:visible"
        >
          <Settings2Icon className="size-3.5" />
        </button>
      </div>

      {boards.map((board) => (
        <Link
          key={board.id}
          to="/home/boards/$boardId"
          params={{ boardId: board.id }}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            board.id === activeBoardId &&
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
            if (name.trim()) createBoard({ teamId: team.id, name });
          }}
        >
          <Input
            autoFocus
            value={name}
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
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PlusIcon className="size-3.5" />
          Add board
        </button>
      )}

      <Link
        to="/home/boards/archive/$teamId"
        params={{ teamId: team.id }}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          team.id === activeArchiveTeamId &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )}
      >
        <ArchiveIcon className="size-3.5" />
        Archive
      </Link>
    </div>
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

  return (
    <CardFiltersPanel
      layout="rail"
      filters={search}
      allTags={allTags}
      teamId={board?.team_id}
      onPatch={(patch) =>
        navigate({
          to: "/home/boards/$boardId",
          params: { boardId },
          search: (prev) => mergeFilters(prev, patch),
          replace: true,
        })
      }
    />
  );
}
