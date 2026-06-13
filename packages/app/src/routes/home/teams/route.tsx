import { createFileRoute, Outlet } from "@tanstack/react-router";
import { TeamRail } from "~/components/teams/TeamRail";

/** The Teams section: the global team rail (bubble switcher) lives here — and
 *  ONLY here — beside the section content. A specific team
 *  (routes/home/teams/$teamId) adds its second-column panel inside this. */
export const Route = createFileRoute("/home/teams")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-0 flex-1">
      <TeamRail />
      <Outlet />
    </div>
  );
}
