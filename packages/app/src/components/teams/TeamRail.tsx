import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { TeamAvatar } from "~/components/custom/TeamAvatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/classUtils";
import { rpc } from "~/lib/rpcClient";
import { useWorkspaceRealtime } from "~/lib/useRealtime";

/** Discord-style far-left rail of team "bubbles": one per team, then a "+" to
 *  create one. Selecting a team opens its second-column panel (see
 *  `<TeamPanel>`). There's no "home" bubble — Teams IS home, so it would only
 *  bounce you back into the team you're already in. */
export function TeamRail({
  variant = "sidebar",
  onNavigate,
}: {
  /** "sidebar" = the desktop inline rail (hidden on mobile); "drawer" = inside
   *  the mobile slide-in Sheet (always visible). */
  variant?: "sidebar" | "drawer";
  /** Called after a navigation tap — lets the mobile drawer close itself. */
  onNavigate?: () => void;
} = {}) {
  // Live: add/remove/rename a team anywhere → the rail updates.
  useWorkspaceRealtime();

  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const { teamId: activeTeamId } = useParams({ strict: false });

  return (
    <aside
      data-sidebar="sidebar"
      className={cn(
        "flex w-18 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-sidebar-border bg-sidebar py-3",
        variant === "sidebar" && "max-md:hidden",
      )}
    >
      {teams?.map((team) => {
        const active = team.id === activeTeamId;
        return (
          <RailBubble key={team.id} active={active}>
            <Link
              to="/home/teams/$teamId"
              params={{ teamId: team.id }}
              title={team.name}
              onClick={onNavigate}
              className={cn(
                "transition-all hover:rounded-lg [&>span]:hover:rounded-lg",
                active && "[&>span]:ring-2 [&>span]:ring-primary",
              )}
            >
              <TeamAvatar id={team.id} name={team.name} />
            </Link>
          </RailBubble>
        );
      })}

      <NewTeamBubble onCreated={onNavigate} />
    </aside>
  );
}

/** Wraps a rail item with the Discord-style active "pill" marker on the left. */
function RailBubble({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex items-center justify-center">
      <span
        className={cn(
          "absolute -left-3 w-1 rounded-r-full bg-primary transition-all",
          active ? "h-7" : "h-0 group-hover:h-4",
        )}
      />
      {children}
    </div>
  );
}

function NewTeamBubble({ onCreated }: { onCreated?: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const { mutate: createTeam, isPending } = useMutation(
    rpc.team.create.mutationOptions({
      onSuccess: async (team) => {
        setName("");
        setOpen(false);
        // Await the refetch BEFORE navigating: the target team route's loader
        // gates on `team.list` containing the team, and `ensureQueryData` would
        // otherwise read the stale cached list (without the new team) and
        // bounce to /home.
        await queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
        navigate({ to: "/home/teams/$teamId", params: { teamId: team.id } });
        onCreated?.();
      },
    }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="New team"
        className="flex size-11 items-center justify-center rounded-xl bg-sidebar-accent text-green1 transition-all hover:rounded-lg hover:bg-green1/20"
      >
        <PlusIcon className="size-5" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-56 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createTeam({ name });
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name + Enter"
            className="h-8 text-sm"
            disabled={isPending}
          />
        </form>
      </PopoverContent>
    </Popover>
  );
}
