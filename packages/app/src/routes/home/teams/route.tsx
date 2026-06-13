import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { PanelLeftIcon } from "lucide-react";
import { useState } from "react";
import { TeamPanel } from "~/components/teams/TeamPanel";
import { TeamRail } from "~/components/teams/TeamRail";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { rpc } from "~/lib/rpcClient";

/** The Teams section: the global team rail (bubble switcher) lives here — and
 *  ONLY here — beside the section content. A specific team
 *  (routes/home/teams/$teamId) adds its second-column panel inside this.
 *
 *  On desktop the rail + panel are static sidebars; on mobile they collapse
 *  into a slide-in drawer reached from the section's mobile bar. */
export const Route = createFileRoute("/home/teams")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-0 flex-1">
      <TeamRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TeamsMobileBar />
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** Mobile-only header (md:hidden) with the drawer trigger + current team name.
 *  The drawer holds the same rail + panel shown inline on desktop. */
function TeamsMobileBar() {
  const [open, setOpen] = useState(false);
  const { teamId } = useParams({ strict: false });
  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const team = teams?.find((t) => t.id === teamId);
  const close = () => setOpen(false);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 py-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open teams menu">
            <PanelLeftIcon />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="flex w-[20rem] max-w-[88vw] flex-row gap-0 p-0 sm:max-w-[20rem]"
        >
          <SheetTitle className="sr-only">Teams navigation</SheetTitle>
          <TeamRail variant="drawer" onNavigate={close} />
          {teamId && (
            <TeamPanel teamId={teamId} variant="drawer" onNavigate={close} />
          )}
        </SheetContent>
      </Sheet>
      <span className="truncate font-display text-sm font-semibold">
        {team?.name ?? "Teams"}
      </span>
    </div>
  );
}
