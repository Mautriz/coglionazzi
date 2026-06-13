import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BoardsSidebar } from "~/components/boards/BoardsSidebar";

/** Boards ecosystem: the global topbar stays (parent layout); this adds the
 *  boards-specific left sidebar (board list, create, filters). */
export const Route = createFileRoute("/home/boards")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-0 flex-1">
      <BoardsSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
