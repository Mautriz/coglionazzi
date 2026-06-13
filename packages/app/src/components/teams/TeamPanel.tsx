import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useMatchRoute,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  ArchiveIcon,
  KanbanIcon,
  LifeBuoyIcon,
  MessagesSquareIcon,
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
import { rpc } from "~/lib/rpcClient";

/** The active team's second column: its name + settings, its boards (with
 *  inline create), and the team's other features (Chat, Archive, Games…).
 *  Rendered by `/home/teams/$teamId` next to the global `<TeamRail>`. When a
 *  board is open it also shows that board's filters. */
export function TeamPanel({
  teamId,
  variant = "sidebar",
  onNavigate,
}: {
  teamId: string;
  /** "sidebar" = desktop inline column (hidden on mobile); "drawer" = inside
   *  the mobile slide-in Sheet (always visible, flexes to fill it). */
  variant?: "sidebar" | "drawer";
  /** Called after a navigation tap — lets the mobile drawer close itself. */
  onNavigate?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const { data: boards } = useQuery(rpc.board.list.queryOptions());
  const team = teams?.find((t) => t.id === teamId);
  const teamBoards = boards?.filter((b) => b.team_id === teamId) ?? [];

  const { boardId: activeBoardId } = useParams({ strict: false });
  const chatActive = !!matchRoute({ to: "/home/teams/$teamId/chat" });
  const archiveActive = !!matchRoute({ to: "/home/teams/$teamId/archive" });
  const supportActive = !!matchRoute({ to: "/home/teams/$teamId/support" });
  // Filters live in the panel for BOTH the board view and the archive (same
  // place, same rail layout — unified).
  const filtersActive = !!activeBoardId || archiveActive;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { mutate: createBoard } = useMutation(
    rpc.board.create.mutationOptions({
      onSuccess: (board) => {
        setName("");
        setCreating(false);
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
        navigate({
          to: "/home/teams/$teamId/board/$boardId",
          params: { teamId, boardId: board.id },
        });
        onNavigate?.();
      },
    }),
  );

  return (
    <aside
      data-sidebar="sidebar"
      className={cn(
        "flex flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground",
        variant === "sidebar" ? "w-60 shrink-0 max-md:hidden" : "min-w-0 flex-1",
      )}
    >
      <div className="pb-2">
        <SearchBox />
      </div>

      <div className="group flex items-center gap-1 px-1 pb-2">
        <h1 className="flex min-w-0 items-center gap-1.5 font-display text-base font-bold">
          <span className="truncate">{team?.name ?? "Team"}</span>
        </h1>
        {team && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground2">
            <UsersIcon className="size-3" />
            {team.memberCount}
          </span>
        )}
        {team && (
          <button
            type="button"
            aria-label="Team settings"
            onClick={() => setSettingsOpen(true)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <Settings2Icon className="size-4" />
          </button>
        )}
      </div>

      <SectionLabel>Boards</SectionLabel>
      {teamBoards.map((board) => (
        <Link
          key={board.id}
          to="/home/teams/$teamId/board/$boardId"
          params={{ teamId, boardId: board.id }}
          onClick={onNavigate}
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
            if (name.trim()) createBoard({ teamId, name });
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

      <div className="mt-3 flex flex-col gap-0.5">
        <SectionLabel>Spaces</SectionLabel>
        <FeatureLink
          to="/home/teams/$teamId/chat"
          teamId={teamId}
          active={chatActive}
          onNavigate={onNavigate}
          icon={<MessagesSquareIcon className="size-4 shrink-0" />}
          label="Chat"
        />
        <FeatureLink
          to="/home/teams/$teamId/support"
          teamId={teamId}
          active={supportActive}
          onNavigate={onNavigate}
          icon={<LifeBuoyIcon className="size-4 shrink-0" />}
          label="Support"
        />
        <FeatureLink
          to="/home/teams/$teamId/archive"
          teamId={teamId}
          active={archiveActive}
          onNavigate={onNavigate}
          icon={<ArchiveIcon className="size-4 shrink-0" />}
          label="Archive"
        />
      </div>

      {filtersActive && (
        <PanelFilters
          teamId={teamId}
          boardId={activeBoardId}
          target={activeBoardId ? "board" : "archive"}
        />
      )}

      {settingsOpen && team && (
        <TeamDialog team={team} onClose={() => setSettingsOpen(false)} />
      )}
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
      {children}
    </h2>
  );
}

function FeatureLink({
  to,
  teamId,
  active,
  icon,
  label,
  onNavigate,
}: {
  to:
    | "/home/teams/$teamId/chat"
    | "/home/teams/$teamId/archive"
    | "/home/teams/$teamId/support";
  teamId: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      params={{ teamId }}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

/** The card filters for whichever feature is open — board OR archive. Both
 *  render in the panel (rail layout) so filtering looks identical everywhere.
 *  State lives in the active route's search params (see lib/cardFilters.ts) so
 *  the view stays shareable; `onPatch` writes back to that route. The route is
 *  team-scoped, so the team for the assignee/tag pickers is just `teamId`. */
function PanelFilters({
  teamId,
  boardId,
  target,
}: {
  teamId: string;
  boardId?: string;
  target: "board" | "archive";
}) {
  const navigate = useNavigate();
  const search: CardFilters & { card?: string } = useSearch({ strict: false });

  return (
    <CardFiltersPanel
      filters={search}
      teamId={teamId}
      onPatch={(patch) => {
        if (target === "board" && boardId) {
          navigate({
            to: "/home/teams/$teamId/board/$boardId",
            params: { teamId, boardId },
            search: (prev) => mergeFilters(prev, patch),
            replace: true,
          });
        } else {
          navigate({
            to: "/home/teams/$teamId/archive",
            params: { teamId },
            search: (prev) => mergeFilters(prev, patch),
            replace: true,
          });
        }
      }}
    />
  );
}
