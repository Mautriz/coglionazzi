import { createFileRoute } from "@tanstack/react-router";
import { serveFile } from "../../server/fileServe";

/** Serve an uploaded file by its storage id. Requires a caller (session
 *  cookie or API key) and per-file authorization — the logic lives in
 *  `server/fileServe.ts` so it can be tested directly. */
export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: ({ request }) => serveFile(request),
    },
  },
});
