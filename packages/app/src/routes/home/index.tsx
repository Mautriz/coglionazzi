import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { ImageUploads } from "~/components/custom/ImageUploads";
import { Logo } from "~/components/custom/Logo";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/authClient";
import { toggleTheme, useTheme } from "~/lib/theme";

export const Route = createFileRoute("/home/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();

  // Demo only: the serialized editor state, shown live below the editor.
  const [editorJson, setEditorJson] = useState<string>();

  async function logout() {
    await authClient.signOut();
    queryClient.removeQueries();
    router.invalidate();
    router.navigate({ to: "/auth/login" });
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="app-topbar flex items-center justify-between border-b px-4 py-3">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
        <h1 className="font-display text-2xl font-bold">
          Ciao, {user?.name} 👋
        </h1>

        {/* Example: rich text editor (lexical). Reuse <RichTextEditor /> for
            any feature that needs formatted text. */}
        <Card>
          <CardContent>
            <CardTitle className="mb-1">Editor</CardTitle>
            <p className="mb-4 text-sm text-muted-foreground">
              Markdown shortcuts work too — try <code>#&nbsp;</code>,{" "}
              <code>-&nbsp;</code>, <code>&gt;&nbsp;</code>,{" "}
              <code>```&nbsp;</code> or <code>**bold**</code>.
            </p>
            <RichTextEditor
              onChange={setEditorJson}
              placeholder="Scrivi qualcosa di intelligente…"
            />
            {editorJson && (
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  Serialized state (persist this)
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-card-border bg-card-background p-2">
                  {JSON.stringify(JSON.parse(editorJson), null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>

        {/* Example: generic image upload + personal gallery. */}
        <Card>
          <CardContent>
            <CardTitle className="mb-1">Images</CardTitle>
            <p className="mb-4 text-sm text-muted-foreground">
              Upload images and copy their URL — usable anywhere in the app.
            </p>
            <ImageUploads />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
