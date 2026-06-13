import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileUploads } from "~/components/custom/FileUploads";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Card, CardContent, CardTitle } from "~/components/ui/card";

/** Playground for the app's building blocks — not a real feature, just the
 *  reference usage of <RichTextEditor /> and the upload stack. */
export const Route = createFileRoute("/home/demo")({
  component: RouteComponent,
});

function RouteComponent() {
  const [editorJson, setEditorJson] = useState<string>();

  return (
    <main className="mx-auto flex w-full max-w-215 flex-1 flex-col gap-6 p-4 py-8">
      <h1 className="font-display text-2xl font-bold">Demo</h1>

      <Card>
        <CardContent>
          <CardTitle className="mb-1">Editor</CardTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            Markdown shortcuts work too — try <code># </code>, <code>- </code>,{" "}
            <code>&gt; </code>, <code>``` </code> or <code>**bold**</code>.
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

      <Card>
        <CardContent>
          <CardTitle className="mb-1">File uploads</CardTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            Images, PDFs, zips, audio, video… up to 20MB. Click an item to
            copy its URL.
          </p>
          <FileUploads />
        </CardContent>
      </Card>
    </main>
  );
}
