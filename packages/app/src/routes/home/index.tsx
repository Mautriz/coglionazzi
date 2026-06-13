import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import { MessageThread } from "~/components/custom/MessageThread";

export const Route = createFileRoute("/home/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
      <h1 className="font-display text-2xl font-bold">Ciao, {user?.name} 👋</h1>

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <MessagesSquareIcon className="size-5 text-primary" />
          Global chat
        </h2>
        <MessageThread roomRef={{ scope: "global" }} emptyText="Say hi 👋" />
      </section>
    </main>
  );
}
