import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../server/db";
import {
  fileServeHeaders,
  fileService,
  type FileMetadata,
} from "../../server/files";

/** Serve an uploaded file by its storage id. The recorded metadata (NOT the
 *  stored id's extension) decides the content type + download name, and
 *  `fileServeHeaders` keeps anything scriptable from running on our origin. */
export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const fileId = url.searchParams.get("fileId");

        if (!fileId) {
          return new Response("Missing fileId query parameter", {
            status: 400,
          });
        }

        const row = await db
          .selectFrom("files")
          .where("path", "=", fileId)
          .select("metadata")
          .executeTakeFirst();

        if (!row || !(await fileService.exists(fileId))) {
          return new Response("File not found", { status: 404 });
        }

        // Fall back to the stored id (its extension still names a type) if a
        // legacy row is missing its metadata.
        const metadata = (row.metadata ?? {}) as Partial<FileMetadata>;

        return new Response(fileService.getFileStream(fileId), {
          status: 200,
          headers: {
            ...fileServeHeaders({
              name: metadata.name ?? fileId,
              type: metadata.type ?? "",
            }),
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
