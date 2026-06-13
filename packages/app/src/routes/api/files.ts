import { createFileRoute } from "@tanstack/react-router";
import mime from "mime";
import { fileService } from "../../server/files";

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

        return new Response(fileService.getFileStream(fileId), {
          status: 200,
          headers: {
            "Content-Type": mime.getType(fileId) || "application/octet-stream",
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
