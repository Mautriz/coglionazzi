import { createFileRoute, Link } from "@tanstack/react-router";
import { FlaskConicalIcon, KanbanIcon } from "lucide-react";
import { Card, CardContent, CardTitle } from "~/components/ui/card";

export const Route = createFileRoute("/home/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
      <h1 className="font-display text-2xl font-bold">Ciao, {user?.name} 👋</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/home/boards">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent>
              <CardTitle className="mb-2 flex items-center gap-2">
                <KanbanIcon className="size-5 text-primary" />
                Boards
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Kanban boards for the crew — cards with tags, rich
                descriptions and attachments.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/home/demo">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent>
              <CardTitle className="mb-2 flex items-center gap-2">
                <FlaskConicalIcon className="size-5 text-primary" />
                Demo
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Playground for the building blocks: rich text editor and file
                uploads.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </main>
  );
}
