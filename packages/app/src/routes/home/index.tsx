import { createFileRoute, redirect } from "@tanstack/react-router";

/** Teams IS the homepage. /home is just the door: /home/teams resolves on to
 *  your first team, or renders the "you're not in any team yet" empty state.
 *  (This used to be the global chat — that now lives at /play.) */
export const Route = createFileRoute("/home/")({
  beforeLoad() {
    throw redirect({ to: "/home/teams" });
  },
});
